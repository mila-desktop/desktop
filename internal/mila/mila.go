package mila

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"mila/internal/cloud"
	"mila/internal/logger"
	"mila/internal/protocol"
	"mila/internal/screen"
	"mila/internal/torrent"
	"mila/internal/tray"
	"mila/internal/updater"
	"mila/internal/version"
)

type Mila struct {
	ctx              context.Context
	log              *logger.Logger
	cloud            *cloud.Client
	updater          *updater.Manager
	trayMgr          *tray.Manager
	trayIconICO      []byte
	isFullscreen     atomic.Bool
	isPip            atomic.Bool
	runtimeStarted   atomic.Bool
	windowStatePath  string
	deepLinkMu       sync.Mutex
	pendingDeepLink  string
	emitCloseEvent   func(ctx context.Context, eventName string)
	emitUpdateStatus func(ctx context.Context, status updater.UpdateStatus)
	quitApp          func(ctx context.Context)
	captureGeometry  func(ctx context.Context) (screen.WindowGeometry, bool)
	openBrowser      func(ctx context.Context, url string)
}

func openSystemBrowser(targetURL string) {
	switch runtime.GOOS {
	case "windows":
		_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", targetURL).Start()
	case "darwin":
		_ = exec.Command("open", targetURL).Start()
	default:
		_ = exec.Command("xdg-open", targetURL).Start()
	}
}

// SetTrayIcon stores the embedded .ico payload used for the native system tray icon.
func (m *Mila) SetTrayIcon(ico []byte) {
	m.trayIconICO = ico
}

// SetTrayPlaying updates the system tray playback label (Pause vs Resume).
func (m *Mila) SetTrayPlaying(playing bool) {
	if m.trayMgr != nil {
		m.trayMgr.SetPlaying(playing)
	}
}

// make_unique mila instance
func New() *Mila {
	statePath, _ := screen.DefaultWindowStatePath()
	cloudClient, cloudErr := cloud.NewDefaultClient()
	m := &Mila{
		log:             logger.Make("mila"),
		cloud:           cloudClient,
		updater:         updater.NewManager(updater.Config{}),
		windowStatePath: statePath,
	}
	if cloudErr != nil {
		m.log.Warn("cloud.init_failed", "err", cloudErr.Error())
	} else if cloudClient != nil {
		if sess, err := cloud.LoadSavedSession(); err == nil && sess != nil && sess.Token != "" {
			cloudClient.SetToken(sess.Token)
		}
	}
	m.openBrowser = func(ctx context.Context, url string) {
		if ctx != nil && m.runtimeStarted.Load() {
			wailsRuntime.BrowserOpenURL(ctx, url)
			return
		}
		openSystemBrowser(url)
	}
	m.emitCloseEvent = func(ctx context.Context, eventName string) {
		if ctx == nil || !m.runtimeStarted.Load() {
			return
		}
		wailsRuntime.EventsEmit(ctx, eventName)
	}
	m.emitUpdateStatus = func(ctx context.Context, status updater.UpdateStatus) {
		if ctx == nil || !m.runtimeStarted.Load() {
			return
		}
		wailsRuntime.EventsEmit(ctx, "mila:update-status", status)
	}
	m.quitApp = func(ctx context.Context) {
		if ctx == nil || !m.runtimeStarted.Load() {
			return
		}
		wailsRuntime.Quit(ctx)
	}
	m.captureGeometry = func(ctx context.Context) (screen.WindowGeometry, bool) {
		if geom, ok := screen.CurrentWindowGeometry("MilaWindow", "Mila"); ok {
			return geom, true
		}
		if ctx == nil || !m.runtimeStarted.Load() {
			return screen.WindowGeometry{}, false
		}
		w, h := wailsRuntime.WindowGetSize(ctx)
		x, y := wailsRuntime.WindowGetPosition(ctx)
		maximized := wailsRuntime.WindowIsMaximised(ctx)
		return screen.NormalizeWindowGeometry(screen.WindowGeometry{
			X:         x,
			Y:         y,
			Width:     w,
			Height:    h,
			Maximized: maximized,
		})
	}
	return m
}

// wails startup hook
func (m *Mila) Startup(ctx context.Context) {
	m.ctx = ctx
	m.runtimeStarted.Store(true)
	m.log.Info("runtime.init", "go_os", runtime.GOOS, "arch", runtime.GOARCH, "cpus", runtime.NumCPU())

	wailsRuntime.WindowSetMinSize(ctx, 858, 651)
	if restored, ok := screen.LoadClampedWindowGeometry(m.windowStatePath); ok {
		wailsRuntime.WindowSetSize(ctx, restored.Width, restored.Height)
		wailsRuntime.WindowSetPosition(ctx, restored.X, restored.Y)
		if restored.Maximized {
			wailsRuntime.WindowMaximise(ctx)
		}
		m.log.Ok("display.restored",
			"x", restored.X,
			"y", restored.Y,
			"window", fmt.Sprintf("%dx%d", restored.Width, restored.Height),
			"maximized", restored.Maximized,
		)
	} else {
		screens, err := wailsRuntime.ScreenGetAll(ctx)
		if err == nil && len(screens) > 0 {
			for i, s := range screens {
				if s.IsCurrent || s.IsPrimary {
					sw := s.Size.Width
					sh := s.Size.Height
					if sw == 0 || sh == 0 {
						sw = s.Width
						sh = s.Height
					}
					if sw > 0 && sh > 0 {
						w := (sw * 3) / 4
						h := (sh * 3) / 4
						wailsRuntime.WindowSetSize(ctx, w, h)
						wailsRuntime.WindowCenter(ctx)
						m.log.Ok("display.ready",
							"index", i,
							"screen", fmt.Sprintf("%dx%d", sw, sh),
							"window", fmt.Sprintf("%dx%d", w, h),
							"radius", 15,
						)
					}
					break
				}
			}
		} else {
			m.log.Warn("display.fallback", "screens", len(screens), "err", err)
		}
	}

	m.trayMgr = tray.NewManager(tray.Config{
		Tooltip: "Mila",
		IconICO: m.trayIconICO,
		Playing: false,
		Visible: true,
		Callbacks: tray.Callbacks{
			OnTogglePlay: func() {
				if m.ctx != nil && m.runtimeStarted.Load() {
					wailsRuntime.EventsEmit(m.ctx, "mila:tray-toggle-play")
				}
			},
			OnToggleShow: func() {
				if m.ctx == nil || !m.runtimeStarted.Load() {
					return
				}
				currentlyVisible := screen.IsWindowCurrentlyVisible("MilaWindow", "Mila")
				if currentlyVisible {
					if m.captureGeometry != nil {
						if geom, ok := m.captureGeometry(m.ctx); ok {
							_ = screen.SaveWindowGeometry(m.windowStatePath, geom)
						}
					}
					wailsRuntime.WindowHide(m.ctx)
					screen.SetWindowVisibility("MilaWindow", "Mila", false)
					if m.trayMgr != nil {
						m.trayMgr.SetVisible(false)
					}
				} else {
					wailsRuntime.WindowShow(m.ctx)
					wailsRuntime.WindowUnminimise(m.ctx)
					screen.SetWindowVisibility("MilaWindow", "Mila", true)
					if m.trayMgr != nil {
						m.trayMgr.SetVisible(true)
					}
				}
			},
			OnCheckUpdate: func() {
				if m.ctx == nil || !m.runtimeStarted.Load() {
					return
				}
				wailsRuntime.WindowShow(m.ctx)
				screen.SetWindowVisibility("MilaWindow", "Mila", true)
				if m.trayMgr != nil {
					m.trayMgr.SetVisible(true)
				}
				go func() {
					_, _ = m.CheckAndInstallUpdate()
				}()
			},
			OnQuit: func() {
				if m.quitApp != nil {
					m.quitApp(m.ctx)
				}
			},
		},
	})

	// clear dwm blur to achieve pure transparent corners
	go func() {
		for i := 0; i < 15; i++ {
			if screen.ClearWindowBlur("MilaWindow", "Mila") {
				m.log.Ok("window.blur_cleared", "attempt", i+1)
				return
			}
			time.Sleep(25 * time.Millisecond)
		}
	}()
}

// BeforeClose notifies the frontend to flush unsaved progress, persists window geometry, and flushes logs.
func (m *Mila) BeforeClose(ctx context.Context) (prevent bool) {
	if ctx == nil {
		ctx = m.ctx
	}
	if m.emitCloseEvent != nil {
		m.emitCloseEvent(ctx, "mila:before-close")
	}
	if m.captureGeometry != nil {
		if geom, ok := m.captureGeometry(ctx); ok {
			if err := screen.SaveWindowGeometry(m.windowStatePath, geom); err != nil {
				m.log.Warn("window.state_save_failed", "err", err.Error())
			} else {
				m.log.Info("window.state_saved", "width", geom.Width, "height", geom.Height, "maximized", geom.Maximized)
			}
		}
	}
	_ = logger.FlushDefaultSink()
	return false
}

// Shutdown finalizes background logging, Watch Together session, system tray, and torrent runtime when the desktop host terminates.
func (m *Mila) Shutdown(ctx context.Context) {
	m.log.Info("runtime.shutdown")
	if m.cloud != nil {
		shutCtx, cancel := context.WithTimeout(context.Background(), 1200*time.Millisecond)
		_ = m.cloud.LeaveWatchRoom(shutCtx)
		_, _ = m.cloud.HeartbeatPresence(shutCtx, "offline", "")
		cancel()
		m.cloud.DisconnectQUIC()
	}
	if m.trayMgr != nil {
		m.trayMgr.Close()
	}
	torrent.DefaultManager().Close()
	_ = logger.CloseDefaultSink()
}

// SaveWindowState persists explicit window placement metrics into local JSON config.
func (m *Mila) SaveWindowState(x, y, width, height int, maximized bool) error {
	return screen.SaveWindowGeometry(m.windowStatePath, screen.WindowGeometry{
		X:         x,
		Y:         y,
		Width:     width,
		Height:    height,
		Maximized: maximized,
	})
}

// SetPendingDeepLink stores a mila:// link received before the frontend is ready.
func (m *Mila) SetPendingDeepLink(link string) {
	if !protocol.IsDeepLink(link) {
		return
	}
	m.deepLinkMu.Lock()
	m.pendingDeepLink = link
	m.deepLinkMu.Unlock()
}

// ConsumePendingDeepLink returns and clears the deep link captured at cold start.
func (m *Mila) ConsumePendingDeepLink() string {
	m.deepLinkMu.Lock()
	defer m.deepLinkMu.Unlock()
	link := m.pendingDeepLink
	m.pendingDeepLink = ""
	return link
}

// HandleDeepLink forwards a mila:// link from a second app instance to the frontend.
func (m *Mila) HandleDeepLink(link string) {
	if !protocol.IsDeepLink(link) {
		return
	}
	m.log.Info("deeplink.received", "link", link)
	if m.ctx == nil || !m.runtimeStarted.Load() {
		m.SetPendingDeepLink(link)
		return
	}
	wailsRuntime.WindowUnminimise(m.ctx)
	wailsRuntime.WindowShow(m.ctx)
	wailsRuntime.EventsEmit(m.ctx, "mila:deep-link", link)
}

// ExportDiagnosticsLogs exports sanitized rotating log archives to a ZIP bundle and returns a `{data}` envelope.
func (m *Mila) ExportDiagnosticsLogs(destDir string) (string, error) {
	_ = logger.FlushDefaultSink()
	report, err := logger.ExportDiagnosticsZip(strings.TrimSpace(destDir))
	if err != nil {
		return `{"error":"failed to export diagnostic logs"}`, err
	}
	raw, err := json.Marshal(map[string]any{"data": report})
	if err != nil {
		return `{"error":"failed to serialize report"}`, err
	}
	return string(raw), nil
}

// GetContractInfo exposes the unified Go<->JS contract descriptor for parity with HTTP `/health`.
func (m *Mila) GetContractInfo() (string, error) {
	raw, err := json.Marshal(map[string]any{
		"data": map[string]any{
			"status":       "ok",
			"mode":         "wails",
			"apiBase":      "/api/v1",
			"extBase":      "/ext",
			"version":      version.Current(),
			"capabilities": []string{"anime", "shikimori", "image", "providers", "torrent", "diagnostics", "cloud", "updater", "aniskip"},
		},
	})
	if err != nil {
		return `{"error":"marshal failed"}`, err
	}
	return string(raw), nil
}

// GetAppVersion returns the running desktop build version tag.
func (m *Mila) GetAppVersion() string {
	return version.Current()
}

// GetUpdateStatus returns the latest updater status as a `{data}` JSON envelope.
func (m *Mila) GetUpdateStatus() (string, error) {
	if m.updater == nil {
		return `{"error":"updater unavailable"}`, fmt.Errorf("updater unavailable")
	}
	raw, err := json.Marshal(map[string]any{"data": m.updater.Status()})
	if err != nil {
		return `{"error":"marshal failed"}`, err
	}
	return string(raw), nil
}

// CheckAndInstallUpdate checks GitHub Releases, downloads newer Windows builds with progress events, and relaunches.
func (m *Mila) CheckAndInstallUpdate() (string, error) {
	if m.updater == nil {
		return `{"error":"updater unavailable"}`, fmt.Errorf("updater unavailable")
	}
	ctx := m.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	checkCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	status := m.updater.CheckAndInstall(
		checkCtx,
		func(st updater.UpdateStatus) {
			if m.emitUpdateStatus != nil {
				m.emitUpdateStatus(m.ctx, st)
			}
		},
		func() {
			if m.quitApp != nil {
				m.quitApp(m.ctx)
			}
		},
	)
	raw, err := json.Marshal(map[string]any{"data": status})
	if err != nil {
		return `{"error":"marshal failed"}`, err
	}
	if status.State == "error" && status.Error != "" {
		return string(raw), errors.New(status.Error)
	}
	return string(raw), nil
}

// CloudPing checks reachability and TLS-pinned status of the mila-cloud backend.
func (m *Mila) CloudPing() (string, error) {
	if m.cloud == nil {
		return `{"error":"cloud client unavailable"}`, fmt.Errorf("cloud client unavailable")
	}
	ctx := m.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	reqCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	res, err := m.cloud.Ping(reqCtx)
	if err != nil {
		return `{"error":"cloud ping failed"}`, err
	}
	raw, err := json.Marshal(map[string]any{"data": res})
	if err != nil {
		return `{"error":"marshal failed"}`, err
	}
	return string(raw), nil
}

// CloudRequest forwards a JSON request through the desktop Go controller over pinned TLS to mila-cloud.
func (m *Mila) CloudRequest(method, path, bodyJSON string) (string, error) {
	if m.cloud == nil {
		return `{"error":"cloud client unavailable"}`, fmt.Errorf("cloud client unavailable")
	}
	ctx := m.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	bodyBytes, err := m.cloud.DoRawJSON(reqCtx, method, path, bodyJSON)
	if err != nil {
		return `{"error":"cloud request failed"}`, err
	}
	if len(bodyBytes) == 0 {
		return `{"data":null}`, nil
	}
	var parsed any
	if err := json.Unmarshal(bodyBytes, &parsed); err != nil {
		return `{"error":"invalid cloud json"}`, err
	}
	raw, err := json.Marshal(map[string]any{"data": parsed})
	if err != nil {
		return `{"error":"marshal failed"}`, err
	}
	return string(raw), nil
}

func publicSessionEnvelope(sess *cloud.CloudSession) (string, error) {
	if sess == nil || sess.User.ID <= 0 {
		return `{"data":null}`, nil
	}
	payload := map[string]any{
		"user":       sess.User,
		"expires_at": sess.ExpiresAt,
	}
	raw, err := json.Marshal(map[string]any{"data": payload})
	if err != nil {
		return `{"error":"marshal failed"}`, err
	}
	return string(raw), nil
}

// CloudLoginWithGoogle launches Google OAuth + PKCE in the system browser and exchanges the code on mila-cloud.
func (m *Mila) CloudLoginWithGoogle() (string, error) {
	if m.cloud == nil {
		return `{"error":"cloud client unavailable"}`, fmt.Errorf("cloud client unavailable")
	}
	ctx := m.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	reqCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()

	sess, err := m.cloud.LoginWithGoogle(reqCtx, func(authURL string) {
		if m.openBrowser != nil {
			m.openBrowser(ctx, authURL)
		}
	})
	if err != nil {
		m.log.Warn("cloud.google_login_failed", "err", err.Error())
		return `{"error":"google sign-in failed"}`, err
	}
	m.log.Info("cloud.google_login_ok", "user_id", sess.User.ID)
	return publicSessionEnvelope(sess)
}

// CloudGetSession validates any locally saved session against mila-cloud /api/v1/auth/me.
func (m *Mila) CloudGetSession() (string, error) {
	saved, loadErr := cloud.LoadSavedSession()
	if loadErr != nil || saved == nil || saved.Token == "" {
		return `{"data":null}`, nil
	}
	if m.cloud == nil {
		return publicSessionEnvelope(saved)
	}
	m.cloud.SetToken(saved.Token)

	ctx := m.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	reqCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	fresh, err := m.cloud.FetchMe(reqCtx)
	if err != nil {
		var apiErr *cloud.APIError
		if errors.As(err, &apiErr) && apiErr.Status == http.StatusUnauthorized {
			m.cloud.SetToken("")
			_ = cloud.ClearSavedSession()
			return `{"data":null}`, nil
		}
		m.log.Warn("cloud.session_verify_fallback", "err", err.Error())
		return publicSessionEnvelope(saved)
	}
	return publicSessionEnvelope(fresh)
}

// CloudLogout revokes the current session on mila-cloud and clears local session storage.
func (m *Mila) CloudLogout() (string, error) {
	if m.cloud == nil {
		_ = cloud.ClearSavedSession()
		return `{"data":{"ok":true}}`, nil
	}
	ctx := m.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	reqCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	m.cloud.DisconnectQUIC()
	if err := m.cloud.Logout(reqCtx); err != nil {
		m.log.Warn("cloud.logout_remote_failed", "err", err.Error())
	}
	return `{"data":{"ok":true}}`, nil
}

func (m *Mila) callCloudEnvelope(fn func(context.Context) (any, error)) (string, error) {
	if m.cloud == nil {
		return `{"error":"cloud client unavailable"}`, fmt.Errorf("cloud client unavailable")
	}
	ctx := m.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	payload, err := fn(reqCtx)
	if err != nil {
		errJSON, _ := json.Marshal(map[string]string{"error": err.Error()})
		return string(errJSON), err
	}
	raw, err := json.Marshal(map[string]any{"data": payload})
	if err != nil {
		return `{"error":"marshal failed"}`, err
	}
	return string(raw), nil
}

// CloudSetUsername updates the user's unique Telegram-style @username on mila-cloud.
func (m *Mila) CloudSetUsername(username string) (string, error) {
	return m.callCloudEnvelope(func(ctx context.Context) (any, error) {
		user, err := m.cloud.SetUsername(ctx, username)
		if err != nil {
			return nil, err
		}
		return map[string]any{"user": user}, nil
	})
}

// CloudSearchUsers searches mila-cloud users by @username, hidden public_id, or display name.
func (m *Mila) CloudSearchUsers(query string, limit int) (string, error) {
	return m.callCloudEnvelope(func(ctx context.Context) (any, error) {
		users, err := m.cloud.SearchUsers(ctx, query, limit)
		if err != nil {
			return nil, err
		}
		return map[string]any{"users": users}, nil
	})
}

// CloudListFriends loads the current user's friends, pending requests, and blocked list.
func (m *Mila) CloudListFriends() (string, error) {
	return m.callCloudEnvelope(func(ctx context.Context) (any, error) {
		return m.cloud.ListFriends(ctx)
	})
}

// CloudSendFriendRequest sends a friend request by @username or hidden public_id (auto-accepts mutual requests).
func (m *Mila) CloudSendFriendRequest(target string) (string, error) {
	return m.callCloudEnvelope(func(ctx context.Context) (any, error) {
		return m.cloud.SendFriendRequest(ctx, target)
	})
}

// CloudAcceptFriendRequest accepts an incoming friend request.
func (m *Mila) CloudAcceptFriendRequest(target string) (string, error) {
	return m.callCloudEnvelope(func(ctx context.Context) (any, error) {
		return m.cloud.AcceptFriendRequest(ctx, target)
	})
}

// CloudDeclineFriendRequest declines an incoming or cancels an outgoing friend request.
func (m *Mila) CloudDeclineFriendRequest(target string) (string, error) {
	return m.callCloudEnvelope(func(ctx context.Context) (any, error) {
		return m.cloud.DeclineFriendRequest(ctx, target)
	})
}

// CloudRemoveFriend removes an existing friendship or pending request.
func (m *Mila) CloudRemoveFriend(target string) (string, error) {
	return m.callCloudEnvelope(func(ctx context.Context) (any, error) {
		return m.cloud.RemoveFriend(ctx, target)
	})
}

// CloudBlockUser blocks a user by @username or public_id.
func (m *Mila) CloudBlockUser(target string) (string, error) {
	return m.callCloudEnvelope(func(ctx context.Context) (any, error) {
		return m.cloud.BlockUser(ctx, target)
	})
}

// CloudUnblockUser unblocks a previously blocked user.
func (m *Mila) CloudUnblockUser(target string) (string, error) {
	return m.callCloudEnvelope(func(ctx context.Context) (any, error) {
		return m.cloud.UnblockUser(ctx, target)
	})
}

func (m *Mila) emitWatchTogetherEvent(ev cloud.WTWireMessage) {
	if m.ctx == nil {
		return
	}
	if ev.Type == "friend_presence" && ev.Friend != nil {
		wailsRuntime.EventsEmit(m.ctx, "mila:friend-presence", ev.Friend)
	}
	wailsRuntime.EventsEmit(m.ctx, "mila:watch-together", ev)
}

// CloudConnectWatchTogether establishes a persistent QUIC connection to mila-cloud for presence and Watch Together rooms.
func (m *Mila) CloudConnectWatchTogether(activity string) (string, error) {
	return m.callCloudEnvelope(func(ctx context.Context) (any, error) {
		if _, err := m.cloud.ConnectQUIC(ctx, activity, m.emitWatchTogetherEvent); err == nil {
			rm, invites, _ := m.cloud.GetCurrentRoom(ctx)
			return map[string]any{
				"connected": true,
				"transport": "quic",
				"room":      rm,
				"invites":   invites,
			}, nil
		}
		// Fallback to HTTPS presence heartbeat if local firewall blocks UDP QUIC.
		prof, err := m.cloud.HeartbeatPresence(ctx, "online", activity)
		if err != nil {
			return nil, err
		}
		rm, invites, _ := m.cloud.GetCurrentRoom(ctx)
		return map[string]any{
			"connected": true,
			"transport": "https",
			"presence":  prof,
			"room":      rm,
			"invites":   invites,
		}, nil
	})
}

// CloudDisconnectWatchTogether closes the active QUIC Watch Together session and marks presence offline.
func (m *Mila) CloudDisconnectWatchTogether() (string, error) {
	if m.cloud != nil {
		ctx := m.ctx
		if ctx == nil {
			ctx = context.Background()
		}
		reqCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
		_, _ = m.cloud.HeartbeatPresence(reqCtx, "offline", "")
		cancel()
		m.cloud.DisconnectQUIC()
	}
	return `{"data":{"ok":true}}`, nil
}

// CloudHeartbeatPresence updates the user's online/offline status and optional activity string.
func (m *Mila) CloudHeartbeatPresence(status, activity string) (string, error) {
	return m.callCloudEnvelope(func(ctx context.Context) (any, error) {
		prof, err := m.cloud.HeartbeatPresence(ctx, status, activity)
		if err != nil {
			return nil, err
		}
		return map[string]any{"presence": prof}, nil
	})
}

// CloudGetWatchRoom returns the user's current Watch Together room snapshot and pending invites.
func (m *Mila) CloudGetWatchRoom() (string, error) {
	return m.callCloudEnvelope(func(ctx context.Context) (any, error) {
		rm, invites, err := m.cloud.GetCurrentRoom(ctx)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"room":    rm,
			"invites": invites,
		}, nil
	})
}

// CloudCreateWatchRoom creates a new Watch Together room over QUIC (with HTTPS fallback).
func (m *Mila) CloudCreateWatchRoom(payloadJSON string) (string, error) {
	return m.callCloudEnvelope(func(ctx context.Context) (any, error) {
		var req cloud.CreateRoomRequest
		if trimmed := strings.TrimSpace(payloadJSON); trimmed != "" {
			if err := json.Unmarshal([]byte(trimmed), &req); err != nil {
				return nil, err
			}
		}
		rm, err := m.cloud.CreateWatchRoom(ctx, req)
		if err != nil {
			return nil, err
		}
		return map[string]any{"room": rm}, nil
	})
}

// CloudJoinWatchRoom joins a Watch Together room by room_id, room_code, or friend_target (@username / public_id).
func (m *Mila) CloudJoinWatchRoom(payloadJSON string) (string, error) {
	return m.callCloudEnvelope(func(ctx context.Context) (any, error) {
		var req cloud.JoinRoomRequest
		if err := json.Unmarshal([]byte(strings.TrimSpace(payloadJSON)), &req); err != nil {
			return nil, err
		}
		rm, err := m.cloud.JoinWatchRoom(ctx, req)
		if err != nil {
			return nil, err
		}
		return map[string]any{"room": rm}, nil
	})
}

// CloudLeaveWatchRoom leaves the active Watch Together room.
func (m *Mila) CloudLeaveWatchRoom() (string, error) {
	return m.callCloudEnvelope(func(ctx context.Context) (any, error) {
		if err := m.cloud.LeaveWatchRoom(ctx); err != nil {
			return nil, err
		}
		return map[string]bool{"ok": true}, nil
	})
}

// CloudSetWatchRoomMedia switches the anime, episode, or voice track inside the active Watch Together room.
func (m *Mila) CloudSetWatchRoomMedia(payloadJSON string) (string, error) {
	return m.callCloudEnvelope(func(ctx context.Context) (any, error) {
		var media cloud.RoomMediaState
		if err := json.Unmarshal([]byte(strings.TrimSpace(payloadJSON)), &media); err != nil {
			return nil, err
		}
		rm, err := m.cloud.SetWatchRoomMedia(ctx, media)
		if err != nil {
			return nil, err
		}
		return map[string]any{"room": rm}, nil
	})
}

// CloudSyncWatchRoomPlayback synchronizes pause/resume, seek position, and playback rate over QUIC.
func (m *Mila) CloudSyncWatchRoomPlayback(payloadJSON string) (string, error) {
	return m.callCloudEnvelope(func(ctx context.Context) (any, error) {
		var req cloud.SyncPlaybackRequest
		if err := json.Unmarshal([]byte(strings.TrimSpace(payloadJSON)), &req); err != nil {
			return nil, err
		}
		pb, err := m.cloud.SyncWatchRoomPlayback(ctx, req)
		if err != nil {
			return nil, err
		}
		return map[string]any{"playback": pb}, nil
	})
}

// CloudUpdateWatchRoomMember updates the current user's ready/buffering/position state in the room.
func (m *Mila) CloudUpdateWatchRoomMember(payloadJSON string) (string, error) {
	return m.callCloudEnvelope(func(ctx context.Context) (any, error) {
		var req cloud.MemberStateRequest
		if err := json.Unmarshal([]byte(strings.TrimSpace(payloadJSON)), &req); err != nil {
			return nil, err
		}
		member, err := m.cloud.UpdateWatchRoomMemberState(ctx, req)
		if err != nil {
			return nil, err
		}
		return map[string]any{"member": member}, nil
	})
}

// CloudSendWatchRoomChat sends a text message or reaction to the Watch Together room.
func (m *Mila) CloudSendWatchRoomChat(text, kind string) (string, error) {
	return m.callCloudEnvelope(func(ctx context.Context) (any, error) {
		msg, err := m.cloud.SendWatchRoomChat(ctx, text, kind)
		if err != nil {
			return nil, err
		}
		return map[string]any{"message": msg}, nil
	})
}

// CloudInviteFriendToWatchRoom sends a direct room invite to a friend by @username or public_id.
func (m *Mila) CloudInviteFriendToWatchRoom(target string) (string, error) {
	return m.callCloudEnvelope(func(ctx context.Context) (any, error) {
		inv, err := m.cloud.InviteFriendToWatchRoom(ctx, target)
		if err != nil {
			return nil, err
		}
		return map[string]any{"invite": inv}, nil
	})
}

// CloudCancelWatchRoomInvite cancels a pending room invite for a friend.
func (m *Mila) CloudCancelWatchRoomInvite(target string) (string, error) {
	return m.callCloudEnvelope(func(ctx context.Context) (any, error) {
		rm, err := m.cloud.CancelWatchRoomInvite(ctx, target)
		if err != nil {
			return nil, err
		}
		return map[string]any{"room": rm}, nil
	})
}

// CloudDeclineWatchRoomInvite declines an incoming room invite.
func (m *Mila) CloudDeclineWatchRoomInvite(target string) (string, error) {
	return m.callCloudEnvelope(func(ctx context.Context) (any, error) {
		if err := m.cloud.DeclineWatchRoomInvite(ctx, target); err != nil {
			return nil, err
		}
		return map[string]bool{"ok": true}, nil
	})
}

// CloudKickWatchRoomMember kicks a member from the room (host only).
func (m *Mila) CloudKickWatchRoomMember(target string) (string, error) {
	return m.callCloudEnvelope(func(ctx context.Context) (any, error) {
		rm, err := m.cloud.KickWatchRoomMember(ctx, target)
		if err != nil {
			return nil, err
		}
		return map[string]any{"room": rm}, nil
	})
}

// CloudTransferWatchRoomHost transfers room host ownership to another member.
func (m *Mila) CloudTransferWatchRoomHost(target string) (string, error) {
	return m.callCloudEnvelope(func(ctx context.Context) (any, error) {
		rm, err := m.cloud.TransferWatchRoomHost(ctx, target)
		if err != nil {
			return nil, err
		}
		return map[string]any{"room": rm}, nil
	})
}

// CloudUpdateWatchRoomSettings updates room title, visibility, control mode, or max members.
func (m *Mila) CloudUpdateWatchRoomSettings(payloadJSON string) (string, error) {
	return m.callCloudEnvelope(func(ctx context.Context) (any, error) {
		var req cloud.UpdateRoomSettingsRequest
		if err := json.Unmarshal([]byte(strings.TrimSpace(payloadJSON)), &req); err != nil {
			return nil, err
		}
		rm, err := m.cloud.UpdateWatchRoomSettings(ctx, req)
		if err != nil {
			return nil, err
		}
		return map[string]any{"room": rm}, nil
	})
}

// SetFullscreen toggles true OS monitor fullscreen (covering the taskbar).
func (m *Mila) SetFullscreen(fullscreen bool) {
	if m.ctx == nil {
		return
	}
	m.isFullscreen.Store(fullscreen)
	if fullscreen {
		wailsRuntime.WindowFullscreen(m.ctx)
		screen.SetWindowFullscreen("MilaWindow", "Mila", true)
	} else {
		screen.SetWindowFullscreen("MilaWindow", "Mila", false)
		wailsRuntime.WindowUnfullscreen(m.ctx)
		screen.ClearWindowBlur("MilaWindow", "Mila")
	}
}

// SetFullscreenFocus adjusts topmost state on Alt+Tab while in fullscreen so the taskbar stays hidden only when active.
func (m *Mila) SetFullscreenFocus(focused bool) {
	if m.ctx == nil || !m.isFullscreen.Load() || m.isPip.Load() {
		return
	}
	screen.SetWindowTopmost("MilaWindow", "Mila", focused)
}

// SetPipMode transforms the native desktop window into an Always-On-Top rounded 16:9 Picture-in-Picture window over all OS apps.
func (m *Mila) SetPipMode(pip bool) {
	if m.ctx == nil {
		return
	}
	if pip {
		if m.isFullscreen.Load() {
			m.SetFullscreen(false)
		}
		m.isPip.Store(true)
		if wailsRuntime.WindowIsMaximised(m.ctx) {
			wailsRuntime.WindowUnmaximise(m.ctx)
		}
		wailsRuntime.WindowSetMinSize(m.ctx, 320, 180)
		wailsRuntime.WindowSetAlwaysOnTop(m.ctx, true)
		screen.SetWindowPip("MilaWindow", "Mila", true)
		return
	}

	m.isPip.Store(false)
	wailsRuntime.WindowSetAlwaysOnTop(m.ctx, false)
	screen.SetWindowPip("MilaWindow", "Mila", false)
	wailsRuntime.WindowSetMinSize(m.ctx, 858, 651)
}

// StartPipDrag initiates a native OS drag on the Picture-in-Picture window.
func (m *Mila) StartPipDrag() {
	if m.ctx == nil || !m.isPip.Load() {
		return
	}
	screen.StartWindowDrag("MilaWindow", "Mila")
}

// GetAniSkipTimes queries AniSkip (with local L1/L2 cache) for OP/ED skip ranges by MAL ID and episode.
func (m *Mila) GetAniSkipTimes(malID int, episode int) (string, error) {
	ctx := m.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	reqCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	res, err := getSharedAniSkipClient().GetSkipTimes(reqCtx, malID, episode)
	if err != nil {
		return `{"error":"aniskip lookup failed"}`, err
	}
	raw, err := json.Marshal(map[string]any{"data": res})
	if err != nil {
		return `{"error":"marshal failed"}`, err
	}
	return string(raw), nil
}
