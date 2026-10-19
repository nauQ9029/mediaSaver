import React from 'react';

export default function Header({ user, status, uploading, onFileUpload, onChooseUpload, onCancelUpload, onLoginClick, onLogout, theme = 'dark', onToggleTheme }) {
  return (
    <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6 mb-8">
      <div>
        <p className="text-xs font-semibold tracking-[0.18em] text-sky-500 uppercase">Media Saver</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Personal Cloud Vault</h1>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        {/* Connection Indicator */}
        <div className="surface-muted inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs">
          <span className={`h-2 w-2 rounded-full ${status.includes('Unable') ? 'bg-rose-500' : 'bg-emerald-400'}`} />
          <span className="text-slate-300">{status}</span>
        </div>

        <button type="button" onClick={onToggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} className="surface-muted inline-flex h-9 w-9 items-center justify-center rounded-full text-sm transition hover:scale-105">
          {theme === 'dark' ? '☼' : '◐'}
        </button>

        {user ? (
          <>
            {uploading && (
              <button
                onClick={onCancelUpload}
                className="bg-rose-950 hover:bg-rose-900 border border-rose-800 text-rose-200 px-3 py-2 rounded-lg text-xs transition"
              >
                Cancel upload
              </button>
            )}
            <button
              type="button"
              onClick={onChooseUpload}
              disabled={uploading}
              className="cursor-pointer bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-semibold px-4 py-2 rounded-lg text-sm transition"
            >
              Upload Media
            </button>
            <input
              id="media-upload-input"
              type="file"
              onChange={onFileUpload}
              className="hidden"
              accept="image/*,video/*"
              disabled={uploading}
            />

            {/* Logout Button */}
            <button
              onClick={onLogout}
              className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 px-3 py-2 rounded-lg text-xs transition"
            >
              Logout ({user.email.split('@')[0]})
            </button>
          </>
        ) : (
          <button
            onClick={onLoginClick}
            className="bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold px-4 py-2 rounded-lg text-sm transition"
          >
            Sign In
          </button>
        )}
      </div>
    </header>
  );
}
