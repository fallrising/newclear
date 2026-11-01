package main

import (
	json "encoding/json/v2"
	"errors"
	"io"
	"mime"
	"net/http"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/transport/httpapi"
)

const maximumSessionBody = 2048

func writeBrowserError(response http.ResponseWriter, status int, code string) {
	// Codes are fixed internal constants, never request data.
	writeRuntimeJSON(response, status, `{"status":"`+code+`"}`)
}

func (handler runtimeHTTPHandler) serveSession(response http.ResponseWriter, request *http.Request) {
	if request.URL.RawPath != "" || request.URL.EscapedPath() != "/api/v1/session" || request.URL.RawQuery != "" || request.URL.ForceQuery {
		writeBrowserError(response, http.StatusBadRequest, "invalid_request")
		return
	}
	if request.Method != http.MethodPost && request.Method != http.MethodGet && request.Method != http.MethodDelete {
		response.Header().Set("Allow", "GET, POST, DELETE")
		writeBrowserError(response, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	if request.Method != http.MethodGet {
		origins := request.Header.Values("Origin")
		if len(origins) != 1 || origins[0] != handler.origin {
			writeBrowserError(response, http.StatusForbidden, "forbidden")
			return
		}
	}
	// Reject malformed and repeated session cookies, including across header lines.
	token, cookieOK := browserCookie(request)
	if !cookieOK {
		writeBrowserError(response, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if request.Method == http.MethodPost {
		contentTypes := request.Header.Values("Content-Type")
		if len(contentTypes) != 1 || len(request.Header.Values("Content-Encoding")) != 0 {
			writeBrowserError(response, http.StatusBadRequest, "invalid_request")
			return
		}
		mediaType, params, err := mime.ParseMediaType(contentTypes[0])
		if err != nil || mediaType != "application/json" || len(params) > 1 || len(params) == 1 && params["charset"] != "utf-8" {
			writeBrowserError(response, http.StatusBadRequest, "invalid_request")
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(response, request.Body, maximumSessionBody))
		if err != nil {
			if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
				writeBrowserError(response, http.StatusRequestEntityTooLarge, "invalid_request")
			} else {
				writeBrowserError(response, http.StatusBadRequest, "invalid_request")
			}
			return
		}
		var wire struct {
			Token string `json:"token"`
		}
		err = json.Unmarshal(body, &wire, json.RejectUnknownMembers(true))
		clear(body)
		if err != nil || !validSessionToken(wire.Token) {
			writeBrowserError(response, http.StatusBadRequest, "invalid_request")
			return
		}
		token = wire.Token
		wire.Token = ""
	}
	session, err := handler.authority.Authenticate(request.Context(), token)
	if err != nil || token == "" {
		writeBrowserError(response, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if request.Method == http.MethodPost || request.Method == http.MethodDelete {
		cookie := &http.Cookie{Name: httpapi.SessionCookieName, Value: token, Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode}
		if request.Method == http.MethodDelete {
			cookie.Value = ""
			cookie.MaxAge = -1
		}
		http.SetCookie(response, cookie)
	}
	status := "authenticated"
	if request.Method == http.MethodDelete {
		status = "logged_out"
	}
	payload, _ := json.Marshal(struct {
		Status string `json:"status"`
		Actor  string `json:"actor"`
	}{Status: status, Actor: string(session.Principal)})
	writeRuntimeJSON(response, http.StatusOK, string(payload))
}

func browserCookie(request *http.Request) (string, bool) {
	var token string
	count := 0
	for _, header := range request.Header.Values("Cookie") {
		cookies, err := http.ParseCookie(header)
		if err != nil {
			return "", false
		}
		for _, cookie := range cookies {
			if cookie.Name == httpapi.SessionCookieName {
				count++
				token = cookie.Value
			}
		}
	}
	return token, count <= 1
}
