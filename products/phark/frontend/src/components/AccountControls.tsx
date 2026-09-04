import { useState, type FormEvent } from "react"
import { Bell, LogIn, LogOut, UserPlus } from "lucide-react"

import {
  login,
  logout,
  register,
  type AccountProfile,
} from "@/api/accounts"
import { getApiErrorMessage } from "@/api/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface AccountControlsProps {
  account: AccountProfile | null
  securityReady: boolean | null
  unreadCount: number
  onAccountChanged: (account: AccountProfile | null) => Promise<void>
  onNavigateNotifications: () => void
  onNavigateProfile: (handle: string) => void
  onRetrySecurity: () => Promise<void>
}

type AuthMode = "login" | "register"

export function AccountControls({
  account,
  securityReady,
  unreadCount,
  onAccountChanged,
  onNavigateNotifications,
  onNavigateProfile,
  onRetrySecurity,
}: AccountControlsProps) {
  const [mode, setMode] = useState<AuthMode>("login")
  const [handle, setHandle] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const canonicalHandle = handle.trim().toLowerCase()
    const trimmedDisplayName = displayName.trim()
    setError(null)
    setNotice(null)

    if (!/^[a-z0-9_]{3,15}$/.test(canonicalHandle)) {
      setError("Handle must be 3–15 lowercase letters, numbers, or underscores.")
      return
    }
    const passwordBytes = new TextEncoder().encode(password).length
    if (passwordBytes < 12 || passwordBytes > 72) {
      setError("Password must be 12–72 UTF-8 bytes.")
      return
    }
    if (mode === "register" && !trimmedDisplayName) {
      setError("Display name is required.")
      return
    }

    setSubmitting(true)
    try {
      if (mode === "register") {
        await register({
          handle: canonicalHandle,
          displayName: trimmedDisplayName,
          password,
        })
        setMode("login")
        setPassword("")
        setNotice("Account created. Sign in to start posting.")
      } else {
        const session = await login({
          handle: canonicalHandle,
          password,
        })
        if (session.account === null) {
          throw new Error("Login completed without an account.")
        }
        setPassword("")
        await onAccountChanged(session.account)
      }
    } catch (error) {
      setError(
        getApiErrorMessage(
          error,
          mode === "register"
            ? "Unable to create account. Please try again."
            : "Unable to sign in. Please try again."
        )
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function handleLogout() {
    setSubmitting(true)
    setError(null)
    try {
      await logout()
      await onAccountChanged(null)
    } catch (error) {
      setError(getApiErrorMessage(error, "Unable to sign out. Please try again."))
    } finally {
      setSubmitting(false)
    }
  }

  if (account !== null) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-3">
        <button
          type="button"
          className="text-left text-sm hover:text-primary"
          onClick={() => onNavigateProfile(account.handle)}
        >
          <span className="block font-medium">{account.displayName}</span>
          <span className="block text-xs text-muted-foreground">
            @{account.handle}
          </span>
        </button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onNavigateNotifications}
        >
          <Bell className="size-3.5" />
          Notifications
          {unreadCount > 0 ? (
            <span
              aria-label={`${unreadCount} unread notifications`}
              className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={submitting}
          onClick={() => void handleLogout()}
        >
          <LogOut className="size-3.5" />
          {submitting ? "Signing out..." : "Sign out"}
        </Button>
        {error ? (
          <p role="alert" className="w-full text-right text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    )
  }

  if (securityReady !== true) {
    return (
      <div className="flex items-center justify-end gap-3">
        <p
          className={`text-xs ${
            securityReady === null
              ? "text-muted-foreground"
              : "text-destructive"
          }`}
        >
          {securityReady === null
            ? "Loading account state..."
            : "Secure actions are unavailable."}
        </p>
        {securityReady === false ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={submitting}
            onClick={() => void onRetrySecurity()}
          >
            Retry
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="w-full max-w-3xl">
      <div className="mb-2 flex items-center justify-end gap-2">
        <Button
          type="button"
          variant={mode === "login" ? "secondary" : "outline"}
          size="sm"
          onClick={() => {
            setMode("login")
            setError(null)
            setNotice(null)
          }}
        >
          <LogIn className="size-3.5" />
          Sign in
        </Button>
        <Button
          type="button"
          variant={mode === "register" ? "secondary" : "outline"}
          size="sm"
          onClick={() => {
            setMode("register")
            setError(null)
            setNotice(null)
          }}
        >
          <UserPlus className="size-3.5" />
          Register
        </Button>
      </div>

      <form
        className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={handleSubmit}
      >
        <div className="space-y-1">
          <Label htmlFor="auth-handle" className="sr-only">
            Handle
          </Label>
          <Input
            id="auth-handle"
            autoComplete="username"
            placeholder="Handle"
            value={handle}
            maxLength={15}
            onChange={(event) => setHandle(event.target.value)}
          />
        </div>
        {mode === "register" ? (
          <div className="space-y-1">
            <Label htmlFor="auth-display-name" className="sr-only">
              Display name
            </Label>
            <Input
              id="auth-display-name"
              autoComplete="name"
              placeholder="Display name"
              value={displayName}
              maxLength={50}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor="auth-password" className="sr-only">
            Password
          </Label>
          <Input
            id="auth-password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <Button type="submit" size="sm" disabled={submitting}>
          {mode === "register" ? (
            <UserPlus className="size-3.5" />
          ) : (
            <LogIn className="size-3.5" />
          )}
          {submitting
            ? "Working..."
            : mode === "register"
              ? "Create account"
              : "Sign in"}
        </Button>
      </form>

      {error || notice ? (
        <p
          role={error ? "alert" : "status"}
          className={`mt-2 text-right text-xs ${
            error ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {error ?? notice}
        </p>
      ) : null}
    </div>
  )
}
