import React from 'react';

export default function Header({ user, status, uploading, onFileUpload, onLoginClick, onLogout }) {
  return (
    <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6 mb-8">
      <div>
        <p className="text-xs font-semibold tracking-[0.2em] text-sky-400 uppercase">Media Saver</p>
        <h1 className="text-3xl font-bold tracking-tight mt-1">Personal Cloud Vault</h1>
      </div>

      <div className="flex items-center gap-3">
        {/* Connection Indicator */}
        <div className="inline-flex items-center gap-2 rounded-full bg-slate-900 border border-slate-800 px-3 py-1.5 text-xs">
          <span className={`h-2 w-2 rounded-full ${status.includes('Unable') ? 'bg-rose-500' : 'bg-emerald-400'}`} />
          <span className="text-slate-300">{status}</span>
        </div>

        {user ? (
          <>
            {/* Upload Button */}
            <label className="cursor-pointer bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold px-4 py-2 rounded-lg text-sm transition flex items-center gap-2">
              <span>{uploading ? 'Uploading...' : 'Upload Media'}</span>
              <input
                type="file"
                onChange={onFileUpload}
                className="hidden"
                accept="image/*,video/*"
                disabled={uploading}
              />
            </label>

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