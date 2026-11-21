package version

import (
	"os"
	"strconv"
	"strings"
)

// Version holds the application semantic version tag; release builds override it via -ldflags.
var Version = "v0.1.8"

// Current returns the active application version, honoring MILA_APP_VERSION if set.
func Current() string {
	if override := strings.TrimSpace(os.Getenv("MILA_APP_VERSION")); override != "" {
		return override
	}
	v := strings.TrimSpace(Version)
	if v == "" {
		return "v0.0.0"
	}
	return v
}

// Normalize strips any leading "v"/"V" and build metadata, returning up to 4 core numbers and prerelease label.
func Normalize(raw string) ([4]int, string) {
	clean := strings.TrimSpace(raw)
	clean = strings.TrimPrefix(clean, "v")
	clean = strings.TrimPrefix(clean, "V")
	if plusIdx := strings.IndexByte(clean, '+'); plusIdx >= 0 {
		clean = clean[:plusIdx]
	}

	var prerelease string
	if dashIdx := strings.IndexByte(clean, '-'); dashIdx >= 0 {
		prerelease = clean[dashIdx+1:]
		clean = clean[:dashIdx]
	}

	var nums [4]int
	parts := strings.Split(clean, ".")
	for i := 0; i < len(parts) && i < 4; i++ {
		n, err := strconv.Atoi(strings.TrimSpace(parts[i]))
		if err == nil && n >= 0 {
			nums[i] = n
		}
	}
	return nums, prerelease
}

// Compare returns 1 if a > b, -1 if a < b, and 0 if equal according to dotted version rules.
func Compare(a, b string) int {
	na, preA := Normalize(a)
	nb, preB := Normalize(b)
	for i := 0; i < 4; i++ {
		if na[i] > nb[i] {
			return 1
		}
		if na[i] < nb[i] {
			return -1
		}
	}
	if preA == "" && preB != "" {
		return 1
	}
	if preA != "" && preB == "" {
		return -1
	}
	if preA > preB {
		return 1
	}
	if preA < preB {
		return -1
	}
	return 0
}
