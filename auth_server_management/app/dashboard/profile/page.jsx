'use client';
import { useEffect, useState } from 'react';

export default function ProfilePage() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Edit Profile Details state
  const [name, setName] = useState('');
  const [picture, setPicture] = useState('');
  const [profileMsg, setProfileMsg] = useState('');
  const [profileErr, setProfileErr] = useState('');
  const [updatingProfile, setUpdatingProfile] = useState(false);
  
  // Password change state
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showOldPwd, setShowOldPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [pwdMsg, setPwdMsg] = useState('');
  const [pwdErr, setPwdErr] = useState('');

  // 2FA state
  const [qrCodeData, setQrCodeData] = useState(null);
  const [totpCode, setTotpCode] = useState('');
  const [twoFAErr, setTwoFAErr] = useState('');
  const [twoFAMsg, setTwoFAMsg] = useState('');

  // 2FA Reset via Email OTP state
  const [showResetOtpForm, setShowResetOtpForm] = useState(false);
  const [resetOtpCode, setResetOtpCode] = useState('');
  const [resetOtpLoading, setResetOtpLoading] = useState(false);
  const [resetSuccessDetails, setResetSuccessDetails] = useState(null);

  // Google unlink state
  const [unlinkMsg, setUnlinkMsg] = useState('');
  const [unlinkErr, setUnlinkErr] = useState('');

  const authServerUrl = process.env.NEXT_PUBLIC_AUTH_SERVER_URL || 'http://localhost:8000';

  const fetchProfile = async () => {
    setLoading(true);
    const token = localStorage.getItem('admin_token');
    try {
      const res = await fetch(`${authServerUrl}/api/v1/user/profile`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setProfile(data);
        setName(data.name || '');
        setPicture(data.picture || '');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  const handleUpdateProfileDetails = async (e) => {
    e.preventDefault();
    setProfileMsg('');
    setProfileErr('');
    setUpdatingProfile(true);
    const token = localStorage.getItem('admin_token');

    try {
      const res = await fetch(`${authServerUrl}/api/v1/admin/users/${profile.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ name, picture })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to update profile details');
      }

      setProfileMsg('Profile details updated successfully!');
      fetchProfile();
    } catch (err) {
      setProfileErr(err.message);
    } finally {
      setUpdatingProfile(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwdMsg('');
    setPwdErr('');
    const token = localStorage.getItem('admin_token');

    try {
      const res = await fetch(`${authServerUrl}/api/v1/user/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to change password');
      }

      setPwdMsg('Password updated successfully!');
      setOldPassword('');
      setNewPassword('');
    } catch (err) {
      setPwdErr(err.message);
    }
  };

  const handleSetup2FA = async () => {
    setTwoFAErr('');
    setTwoFAMsg('');
    const token = localStorage.getItem('admin_token');

    try {
      const res = await fetch(`${authServerUrl}/api/v1/user/2fa/setup-qr`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setQrCodeData(await res.json());
      }
    } catch (err) {
      setTwoFAErr('Failed to generate 2FA QR code');
    }
  };

  const handleVerify2FA = async (e) => {
    e.preventDefault();
    setTwoFAErr('');
    setTwoFAMsg('');
    const token = localStorage.getItem('admin_token');

    try {
      const res = await fetch(`${authServerUrl}/api/v1/user/2fa/verify-and-enable`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ totp_code: totpCode })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Invalid verification code');
      }

      setTwoFAMsg('2FA successfully enabled for your account!');
      setQrCodeData(null);
      setResetSuccessDetails(null);
      setTotpCode('');
      fetchProfile();
    } catch (err) {
      setTwoFAErr(err.message);
    }
  };

  const handleDisable2FA = async () => {
    if (!confirm('Are you sure you want to disable 2FA?')) return;
    setTwoFAErr('');
    setTwoFAMsg('');
    const token = localStorage.getItem('admin_token');

    try {
      const res = await fetch(`${authServerUrl}/api/v1/user/2fa/disable`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setTwoFAMsg('2FA disabled successfully.');
        fetchProfile();
      }
    } catch (err) {
      setTwoFAErr('Failed to disable 2FA');
    }
  };

  // Request Email OTP to reset 2FA Key (Security requirement)
  const handleRequestReset2FAOtp = async () => {
    setTwoFAErr('');
    setTwoFAMsg('');
    setResetOtpLoading(true);
    const token = localStorage.getItem('admin_token');

    try {
      const res = await fetch(`${authServerUrl}/api/v1/user/2fa/reset-request-otp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to request OTP');
      }

      const data = await res.json();
      setTwoFAMsg(data.message || 'Security OTP sent to your registered email!');
      setShowResetOtpForm(true);
    } catch (err) {
      setTwoFAErr(err.message);
    } finally {
      setResetOtpLoading(false);
    }
  };

  // Confirm Email OTP to reset 2FA Key
  const handleConfirmReset2FAOtp = async (e) => {
    e.preventDefault();
    setTwoFAErr('');
    setTwoFAMsg('');
    setResetOtpLoading(true);
    const token = localStorage.getItem('admin_token');

    try {
      const res = await fetch(`${authServerUrl}/api/v1/user/2fa/reset-confirm-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ otp_code: resetOtpCode })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Invalid OTP verification code');
      }

      const data = await res.json();
      setTwoFAMsg('2FA secret key reset successfully! Scan your new QR code below to activate.');
      setResetSuccessDetails(data);
      setShowResetOtpForm(false);
      setResetOtpCode('');
      fetchProfile();
    } catch (err) {
      setTwoFAErr(err.message);
    } finally {
      setResetOtpLoading(false);
    }
  };

  const handleUnlinkGoogle = async () => {
    if (!confirm('Unlink Google login for this account?')) return;
    setUnlinkMsg('');
    setUnlinkErr('');
    const token = localStorage.getItem('admin_token');

    try {
      const res = await fetch(`${authServerUrl}/api/v1/user/unlink-google`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to unlink Google account');
      }

      setUnlinkMsg('Google account unlinked!');
      fetchProfile();
    } catch (err) {
      setUnlinkErr(err.message);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-400">Loading user profile...</div>;
  }

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">IAM My Profile & Security</h1>
        <p className="text-slate-400 text-sm">View user details, update credentials, reset password, and configure 2FA step-up</p>
      </div>

      {/* Modern User Details Card */}
      <div className="p-6 bg-slate-900/80 border border-slate-800 rounded-3xl shadow-xl space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-slate-800">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-500 via-teal-500 to-indigo-600 border border-slate-700 flex items-center justify-center text-white font-bold text-2xl shadow-lg overflow-hidden shrink-0">
              {profile?.picture ? (
                <img src={profile.picture} alt={profile.name || 'User'} className="w-full h-full object-cover" />
              ) : (
                (profile?.name || profile?.email || 'U').charAt(0).toUpperCase()
              )}
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl font-bold text-white">{profile?.name || 'User'}</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {profile?.role_label || profile?.role}
                </span>
              </div>
              <p className="text-sm text-slate-400 font-mono mt-0.5">{profile?.email}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300">
              Provider: <strong className="text-white capitalize">{profile?.provider}</strong>
            </span>
            <span className={`px-3 py-1.5 rounded-xl border font-semibold ${profile?.is_2fa_enabled ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
              2FA: {profile?.is_2fa_enabled ? 'Active' : 'Disabled'}
            </span>
            {profile?.provider === 'google' && (
              <button
                onClick={handleUnlinkGoogle}
                className="px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 transition font-medium"
              >
                Unlink Google
              </button>
            )}
          </div>
        </div>

        {/* Edit User Details Form */}
        <form onSubmit={handleUpdateProfileDetails} className="space-y-4">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Edit User Details</h3>
          
          {profileMsg && <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">{profileMsg}</div>}
          {profileErr && <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">{profileErr}</div>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Full Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter full name"
                className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Profile Picture URL</label>
              <input
                type="text"
                value={picture}
                onChange={(e) => setPicture(e.target.value)}
                placeholder="https://example.com/avatar.jpg"
                className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={updatingProfile}
              className="px-5 py-2.5 bg-slate-800 border border-slate-700 text-emerald-400 font-semibold rounded-xl text-sm hover:bg-slate-700 transition"
            >
              {updatingProfile ? 'Saving...' : 'Save Profile Details'}
            </button>
          </div>
        </form>
      </div>

      {unlinkMsg && <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm">{unlinkMsg}</div>}
      {unlinkErr && <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{unlinkErr}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Password Reset Section */}
        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-3xl shadow-xl space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">🔑</span>
            <h3 className="text-lg font-bold text-white">Password Reset</h3>
          </div>
          
          {pwdMsg && <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">{pwdMsg}</div>}
          {pwdErr && <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">{pwdErr}</div>}

          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Current Password</label>
              <div className="relative">
                <input
                  type={showOldPwd ? 'text' : 'password'}
                  required
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 pr-10 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
                <button type="button" onClick={() => setShowOldPwd(!showOldPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                  {showOldPwd ? '👁️' : '🙈'}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">New Password</label>
              <div className="relative">
                <input
                  type={showNewPwd ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 pr-10 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
                <button type="button" onClick={() => setShowNewPwd(!showNewPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                  {showNewPwd ? '👁️' : '🙈'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-gradient-to-r from-emerald-500 to-indigo-600 font-semibold text-white rounded-xl text-sm shadow-md hover:opacity-95"
            >
              Reset & Update Password
            </button>
          </form>
        </div>

        {/* 2FA Setup & Security Reset via Email OTP Section */}
        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-3xl shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">🛡️</span>
              <h3 className="text-lg font-bold text-white">2FA Security Management</h3>
            </div>
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${profile?.is_2fa_enabled ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-slate-800 text-slate-400'}`}>
              {profile?.is_2fa_enabled ? '2FA Enabled' : '2FA Off'}
            </span>
          </div>

          {twoFAMsg && <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">{twoFAMsg}</div>}
          {twoFAErr && <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">{twoFAErr}</div>}

          {!profile?.is_2fa_enabled && !qrCodeData && !resetSuccessDetails && (
            <div className="space-y-4">
              <p className="text-xs text-slate-400">Setup two-factor TOTP authentication with Google Authenticator or Authy.</p>
              <button
                onClick={handleSetup2FA}
                className="w-full py-3 bg-slate-800 border border-slate-700 text-emerald-400 font-semibold rounded-xl text-sm hover:bg-slate-700 transition"
              >
                + Setup 2FA (Generate QR Code)
              </button>
            </div>
          )}

          {/* Render Initial 2FA QR Code Setup */}
          {qrCodeData && !profile?.is_2fa_enabled && (
            <div className="space-y-4 text-center">
              <div className="p-3 bg-white rounded-2xl inline-block shadow-md">
                <img src={qrCodeData.qr_code} alt="2FA QR Code" className="w-36 h-36 mx-auto" />
              </div>
              <p className="text-[10px] text-slate-400 font-mono select-all">Secret: {qrCodeData.totp_secret}</p>

              <form onSubmit={handleVerify2FA} className="space-y-3">
                <input
                  type="text"
                  required
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  placeholder="Enter 6-digit code"
                  className="w-full px-3.5 py-2 bg-slate-800 border border-slate-700 rounded-xl text-emerald-400 font-mono text-center tracking-widest text-lg focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
                <button
                  type="submit"
                  className="w-full py-2.5 bg-emerald-500 text-slate-950 font-bold rounded-xl text-sm hover:opacity-95"
                >
                  Verify & Activate 2FA
                </button>
              </form>
            </div>
          )}

          {/* Render Reset 2FA Success New Secret Key & QR Code */}
          {resetSuccessDetails && (
            <div className="space-y-4 text-center p-4 bg-slate-950 rounded-2xl border border-amber-500/30">
              <h4 className="text-xs font-bold text-amber-300 uppercase">New 2FA Secret Key Generated</h4>
              <div className="p-3 bg-white rounded-2xl inline-block shadow-md">
                <img src={resetSuccessDetails.qr_code} alt="New 2FA QR Code" className="w-36 h-36 mx-auto" />
              </div>
              <p className="text-[10px] text-slate-400 font-mono select-all">New Secret: {resetSuccessDetails.totp_secret}</p>

              <form onSubmit={handleVerify2FA} className="space-y-3">
                <input
                  type="text"
                  required
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  placeholder="Enter 6-digit app code"
                  className="w-full px-3.5 py-2 bg-slate-800 border border-slate-700 rounded-xl text-emerald-400 font-mono text-center tracking-widest text-lg focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
                <button
                  type="submit"
                  className="w-full py-2.5 bg-emerald-500 text-slate-950 font-bold rounded-xl text-sm hover:opacity-95"
                >
                  Verify Code & Re-Activate 2FA
                </button>
              </form>
            </div>
          )}

          {/* 2FA Enabled Actions: Reset 2FA via Email OTP OR Disable 2FA */}
          {profile?.is_2fa_enabled && (
            <div className="space-y-4 pt-2 border-t border-slate-800">
              <p className="text-xs text-slate-300">Two-factor authentication is active on your account.</p>

              {!showResetOtpForm ? (
                <div className="space-y-2">
                  {/* Reset 2FA via Email OTP */}
                  <button
                    type="button"
                    onClick={handleRequestReset2FAOtp}
                    disabled={resetOtpLoading}
                    className="w-full py-2.5 bg-amber-500/10 border border-amber-500/30 text-amber-300 font-semibold rounded-xl text-sm hover:bg-amber-500/20 transition"
                  >
                    {resetOtpLoading ? 'Sending OTP Email...' : '🔄 Reset 2FA Key (Requires Email OTP)'}
                  </button>

                  <button
                    type="button"
                    onClick={handleDisable2FA}
                    className="w-full py-2.5 bg-rose-500/10 border border-rose-500/30 text-rose-300 font-semibold rounded-xl text-sm hover:bg-rose-500/20 transition"
                  >
                    Disable 2FA Security
                  </button>
                </div>
              ) : (
                /* Step 2 of 2FA Reset: Email OTP Verification */
                <form onSubmit={handleConfirmReset2FAOtp} className="p-4 bg-slate-950 rounded-2xl border border-amber-500/40 space-y-3">
                  <div className="text-left">
                    <h4 className="text-xs font-bold text-amber-300 uppercase">Verify Email OTP to Reset 2FA</h4>
                    <p className="text-[11px] text-slate-400">Enter the 6-digit OTP code sent to {profile?.email}:</p>
                  </div>

                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={resetOtpCode}
                    onChange={(e) => setResetOtpCode(e.target.value)}
                    placeholder="123456"
                    className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-amber-300 font-mono text-center tracking-widest text-xl focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowResetOtpForm(false)}
                      className="py-2 px-3 bg-slate-800 text-slate-400 text-xs rounded-xl font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={resetOtpLoading || resetOtpCode.length < 6}
                      className="flex-1 py-2 bg-amber-500 text-slate-950 font-bold text-xs rounded-xl hover:opacity-95 disabled:opacity-50"
                    >
                      {resetOtpLoading ? 'Verifying...' : 'Verify OTP & Generate New 2FA Key'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
