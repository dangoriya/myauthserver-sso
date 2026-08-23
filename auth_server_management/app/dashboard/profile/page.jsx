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
  
  // Password Management state
  // Steps for Password Reset: 1 = Enter Old Password, 2 = Enter Email OTP, 3 = Set New Password & Confirm Password
  const [pwdStep, setPwdStep] = useState(1);
  const [oldPassword, setOldPassword] = useState('');
  const [pwdOtpCode, setPwdOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showOldPwd, setShowOldPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [pwdMsg, setPwdMsg] = useState('');
  const [pwdErr, setPwdErr] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);

  // Set New Password (when user has no password set) state
  const [setPwdNew, setSetPwdNew] = useState('');
  const [setPwdConfirm, setSetPwdConfirm] = useState('');
  const [showSetPwdNew, setShowSetPwdNew] = useState(false);
  const [showSetPwdConfirm, setShowSetPwdConfirm] = useState(false);

  // 2FA state
  const [qrCodeData, setQrCodeData] = useState(null);
  const [totpCode, setTotpCode] = useState('');
  const [twoFAErr, setTwoFAErr] = useState('');
  const [twoFAMsg, setTwoFAMsg] = useState('');

  // 2FA Disable via Email OTP state
  const [showDisable2FAOtpForm, setShowDisable2FAOtpForm] = useState(false);
  const [disable2FAOtpCode, setDisable2FAOtpCode] = useState('');
  const [disable2FAOtpLoading, setDisable2FAOtpLoading] = useState(false);

  // 2FA Reset Key via Email OTP state
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

  // --- PASSWORD MANAGEMENT HANDLERS ---

  // Handle Set Initial Password (when profile.has_password is false)
  const handleSetInitialPassword = async (e) => {
    e.preventDefault();
    setPwdMsg('');
    setPwdErr('');

    if (setPwdNew !== setPwdConfirm) {
      setPwdErr('Passwords do not match');
      return;
    }
    if (setPwdNew.length < 6) {
      setPwdErr('Password must be at least 6 characters long');
      return;
    }

    setPwdLoading(true);
    const token = localStorage.getItem('admin_token');

    try {
      const res = await fetch(`${authServerUrl}/api/v1/user/set-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ new_password: setPwdNew })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to set new password');
      }

      setPwdMsg('New password set successfully!');
      setSetPwdNew('');
      setSetPwdConfirm('');
      fetchProfile();
    } catch (err) {
      setPwdErr(err.message);
    } finally {
      setPwdLoading(false);
    }
  };

  // Password Reset Step 1: Verify Current Old Password
  const handleVerifyOldPassword = async (e) => {
    e.preventDefault();
    setPwdMsg('');
    setPwdErr('');
    setPwdLoading(true);
    const token = localStorage.getItem('admin_token');

    try {
      const res = await fetch(`${authServerUrl}/api/v1/user/password-reset/verify-old-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ old_password: oldPassword })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Current password is incorrect');
      }

      // Automatically trigger sending the Email OTP
      const otpRes = await fetch(`${authServerUrl}/api/v1/user/password-reset/request-otp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!otpRes.ok) {
        const otpData = await otpRes.json();
        throw new Error(otpData.detail || 'Failed to send OTP code to email');
      }

      setPwdMsg(`Current password verified! 6-digit code sent to ${profile?.email}`);
      setPwdStep(2);
    } catch (err) {
      setPwdErr(err.message);
    } finally {
      setPwdLoading(false);
    }
  };

  // Password Reset Step 2: Validate Email OTP Code
  const handleVerifyPwdOtpCode = (e) => {
    e.preventDefault();
    setPwdMsg('');
    setPwdErr('');

    if (pwdOtpCode.trim().length < 6) {
      setPwdErr('Please enter the full 6-digit code');
      return;
    }

    setPwdMsg('Code accepted! Now set your new password.');
    setPwdStep(3);
  };

  // Password Reset Step 3: Set New Password + Confirm Password with Email OTP
  const handleConfirmPasswordReset = async (e) => {
    e.preventDefault();
    setPwdMsg('');
    setPwdErr('');

    if (newPassword !== confirmPassword) {
      setPwdErr('New password and confirmation password do not match');
      return;
    }
    if (newPassword.length < 6) {
      setPwdErr('Password must be at least 6 characters long');
      return;
    }

    setPwdLoading(true);
    const token = localStorage.getItem('admin_token');

    try {
      const res = await fetch(`${authServerUrl}/api/v1/user/password-reset/confirm-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          otp_code: pwdOtpCode,
          new_password: newPassword
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to reset password');
      }

      setPwdMsg('Password reset successfully!');
      setPwdStep(1);
      setOldPassword('');
      setPwdOtpCode('');
      setNewPassword('');
      setConfirmPassword('');
      fetchProfile();
    } catch (err) {
      setPwdErr(err.message);
    } finally {
      setPwdLoading(false);
    }
  };

  // --- 2FA HANDLERS ---

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
      } else {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to generate 2FA QR code');
      }
    } catch (err) {
      setTwoFAErr(err.message);
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

  // Request Email OTP to Disable 2FA
  const handleRequestDisable2FAOtp = async () => {
    setTwoFAErr('');
    setTwoFAMsg('');
    setDisable2FAOtpLoading(true);
    const token = localStorage.getItem('admin_token');

    try {
      const res = await fetch(`${authServerUrl}/api/v1/user/2fa/disable-request-otp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to request OTP to disable 2FA');
      }

      setTwoFAMsg(`Verification code sent to ${profile?.email} to disable 2FA`);
      setShowDisable2FAOtpForm(true);
    } catch (err) {
      setTwoFAErr(err.message);
    } finally {
      setDisable2FAOtpLoading(false);
    }
  };

  // Confirm Email OTP to Disable 2FA
  const handleConfirmDisable2FAOtp = async (e) => {
    e.preventDefault();
    setTwoFAErr('');
    setTwoFAMsg('');
    setDisable2FAOtpLoading(true);
    const token = localStorage.getItem('admin_token');

    try {
      const res = await fetch(`${authServerUrl}/api/v1/user/2fa/disable-confirm-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ otp_code: disable2FAOtpCode })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Invalid verification code');
      }

      setTwoFAMsg('2FA disabled successfully.');
      setShowDisable2FAOtpForm(false);
      setDisable2FAOtpCode('');
      fetchProfile();
    } catch (err) {
      setTwoFAErr(err.message);
    } finally {
      setDisable2FAOtpLoading(false);
    }
  };

  // Request Email OTP to reset 2FA Key
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

  // Inline input validation styling helper with red glow
  const inputClass = (isInvalid = false) =>
    `w-full px-3.5 py-2.5 bg-slate-800 border rounded-xl text-white text-sm focus:outline-none transition-all duration-200 ${
      isInvalid
        ? 'border-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.4)] focus:border-rose-400 focus:ring-2 focus:ring-rose-500/40'
        : 'border-slate-700 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40'
    }`;

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
                className={inputClass()}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Profile Picture URL</label>
              <input
                type="text"
                value={picture}
                onChange={(e) => setPicture(e.target.value)}
                placeholder="https://example.com/avatar.jpg"
                className={inputClass()}
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
        {/* Password Management Section */}
        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-3xl shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">🔑</span>
              <h3 className="text-lg font-bold text-white">
                {!profile?.has_password ? 'Set New Password' : 'Reset Password'}
              </h3>
            </div>
            {profile?.has_password && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-400">
                Step {pwdStep} of 3
              </span>
            )}
          </div>
          
          {pwdMsg && <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">{pwdMsg}</div>}
          {pwdErr && <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">{pwdErr}</div>}

          {/* CASE 1: Password NOT Set Yet (e.g. Google Login user) */}
          {!profile?.has_password ? (
            <form onSubmit={handleSetInitialPassword} className="space-y-4">
              <p className="text-xs text-slate-400">
                You logged in with an external provider and haven't set a local password yet. Set a password below to enable local credentials login.
              </p>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">New Password</label>
                <div className="relative">
                  <input
                    type={showSetPwdNew ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={setPwdNew}
                    onChange={(e) => setSetPwdNew(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className={inputClass(setPwdNew.length > 0 && setPwdNew.length < 6)}
                  />
                  <button type="button" onClick={() => setShowSetPwdNew(!showSetPwdNew)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                    {showSetPwdNew ? '👁️' : '🙈'}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Confirm New Password</label>
                <div className="relative">
                  <input
                    type={showSetPwdConfirm ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={setPwdConfirm}
                    onChange={(e) => setSetPwdConfirm(e.target.value)}
                    placeholder="Re-enter new password"
                    className={inputClass(setPwdConfirm.length > 0 && (setPwdConfirm !== setPwdNew || setPwdConfirm.length < 6))}
                  />
                  <button type="button" onClick={() => setShowSetPwdConfirm(!showSetPwdConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                    {showSetPwdConfirm ? '👁️' : '🙈'}
                  </button>
                </div>
                {setPwdConfirm.length > 0 && setPwdConfirm !== setPwdNew && (
                  <p className="text-[11px] text-rose-400 mt-1">Passwords do not match</p>
                )}
              </div>

              <button
                type="submit"
                disabled={pwdLoading}
                className="w-full py-3 bg-gradient-to-r from-emerald-500 to-indigo-600 font-semibold text-white rounded-xl text-sm shadow-md hover:opacity-95 disabled:opacity-50"
              >
                {pwdLoading ? 'Setting Password...' : 'Set New Password'}
              </button>
            </form>
          ) : (
            /* CASE 2: Password Already Set -> 3-Step Reset Workflow */
            <div className="space-y-4">
              {/* STEP 1: Enter Current (Old) Password */}
              {pwdStep === 1 && (
                <form onSubmit={handleVerifyOldPassword} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Current Password</label>
                    <div className="relative">
                      <input
                        type={showOldPwd ? 'text' : 'password'}
                        required
                        value={oldPassword}
                        onChange={(e) => setOldPassword(e.target.value)}
                        placeholder="Enter current password"
                        className={inputClass(pwdErr.length > 0)}
                      />
                      <button type="button" onClick={() => setShowOldPwd(!showOldPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                        {showOldPwd ? '👁️' : '🙈'}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">Step 1: Verify current password to trigger email security code</p>
                  </div>

                  <button
                    type="submit"
                    disabled={pwdLoading || !oldPassword}
                    className="w-full py-3 bg-gradient-to-r from-emerald-500 to-indigo-600 font-semibold text-white rounded-xl text-sm shadow-md hover:opacity-95 disabled:opacity-50"
                  >
                    {pwdLoading ? 'Verifying...' : 'Verify Password & Request Email Code →'}
                  </button>
                </form>
              )}

              {/* STEP 2: Enter 6-Digit Email Verification Code */}
              {pwdStep === 2 && (
                <form onSubmit={handleVerifyPwdOtpCode} className="space-y-4">
                  <div className="p-3 bg-sky-950/60 border border-sky-500/30 rounded-2xl">
                    <p className="text-xs text-sky-200">
                      Current password verified! Enter the 6-digit security code sent to <strong>{profile?.email}</strong>:
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">6-Digit Verification Code</label>
                    <input
                      type="text"
                      required
                      maxLength={6}
                      value={pwdOtpCode}
                      onChange={(e) => setPwdOtpCode(e.target.value)}
                      placeholder="123456"
                      className={`w-full px-3.5 py-2.5 bg-slate-800 border rounded-xl text-sky-300 font-mono text-center tracking-widest text-xl focus:outline-none transition-all duration-200 ${
                        pwdOtpCode.length > 0 && pwdOtpCode.length < 6
                          ? 'border-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.4)]'
                          : 'border-sky-500/50 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                      }`}
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPwdStep(1)}
                      className="py-2.5 px-4 bg-slate-800 text-slate-300 font-medium rounded-xl text-xs"
                    >
                      ← Back
                    </button>
                    <button
                      type="submit"
                      disabled={pwdOtpCode.trim().length < 6}
                      className="flex-1 py-2.5 bg-sky-500 text-slate-950 font-bold rounded-xl text-xs hover:opacity-95 disabled:opacity-50"
                    >
                      Verify Code & Continue →
                    </button>
                  </div>
                </form>
              )}

              {/* STEP 3: Set New Password + Confirm Password */}
              {pwdStep === 3 && (
                <form onSubmit={handleConfirmPasswordReset} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">New Password</label>
                    <div className="relative">
                      <input
                        type={showNewPwd ? 'text' : 'password'}
                        required
                        minLength={6}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Minimum 6 characters"
                        className={inputClass(newPassword.length > 0 && newPassword.length < 6)}
                      />
                      <button type="button" onClick={() => setShowNewPwd(!showNewPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                        {showNewPwd ? '👁️' : '🙈'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Confirm New Password</label>
                    <div className="relative">
                      <input
                        type={showConfirmPwd ? 'text' : 'password'}
                        required
                        minLength={6}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter new password"
                        className={inputClass(confirmPassword.length > 0 && (confirmPassword !== newPassword || confirmPassword.length < 6))}
                      />
                      <button type="button" onClick={() => setShowConfirmPwd(!showConfirmPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                        {showConfirmPwd ? '👁️' : '🙈'}
                      </button>
                    </div>
                    {confirmPassword.length > 0 && confirmPassword !== newPassword && (
                      <p className="text-[11px] text-rose-400 mt-1">Passwords do not match</p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPwdStep(2)}
                      className="py-2.5 px-4 bg-slate-800 text-slate-300 font-medium rounded-xl text-xs"
                    >
                      ← Back
                    </button>
                    <button
                      type="submit"
                      disabled={pwdLoading || !newPassword || newPassword !== confirmPassword}
                      className="flex-1 py-3 bg-gradient-to-r from-emerald-500 to-indigo-600 font-semibold text-white rounded-xl text-sm shadow-md hover:opacity-95 disabled:opacity-50"
                    >
                      {pwdLoading ? 'Resetting Password...' : 'Confirm Reset Password'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>

        {/* 2FA Setup & Security Management Section */}
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
              <div className="text-[11px] text-slate-300 space-y-1">
                <p>Service: <strong className="text-emerald-400">{qrCodeData.service_name || 'IAM Auth Server'}</strong></p>
                <p className="text-[10px] text-slate-400 font-mono select-all">Secret: {qrCodeData.totp_secret}</p>
              </div>

              <form onSubmit={handleVerify2FA} className="space-y-3">
                <input
                  type="text"
                  required
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  placeholder="Enter 6-digit code"
                  className={`w-full px-3.5 py-2 bg-slate-800 border rounded-xl text-emerald-400 font-mono text-center tracking-widest text-lg focus:outline-none transition-all duration-200 ${
                    totpCode.length > 0 && totpCode.length < 6
                      ? 'border-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.4)]'
                      : 'border-slate-700 focus:ring-2 focus:ring-emerald-400'
                  }`}
                />
                <button
                  type="submit"
                  disabled={totpCode.length < 6}
                  className="w-full py-2.5 bg-emerald-500 text-slate-950 font-bold rounded-xl text-sm hover:opacity-95 disabled:opacity-50"
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
              <div className="text-[11px] text-slate-300 space-y-1">
                <p>Service: <strong className="text-amber-400">{resetSuccessDetails.service_name || 'IAM Auth Server'}</strong></p>
                <p className="text-[10px] text-slate-400 font-mono select-all">Secret: {resetSuccessDetails.totp_secret}</p>
              </div>

              <form onSubmit={handleVerify2FA} className="space-y-3">
                <input
                  type="text"
                  required
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  placeholder="Enter 6-digit app code"
                  className={`w-full px-3.5 py-2 bg-slate-800 border rounded-xl text-emerald-400 font-mono text-center tracking-widest text-lg focus:outline-none transition-all duration-200 ${
                    totpCode.length > 0 && totpCode.length < 6
                      ? 'border-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.4)]'
                      : 'border-slate-700 focus:ring-2 focus:ring-emerald-400'
                  }`}
                />
                <button
                  type="submit"
                  disabled={totpCode.length < 6}
                  className="w-full py-2.5 bg-emerald-500 text-slate-950 font-bold rounded-xl text-sm hover:opacity-95 disabled:opacity-50"
                >
                  Verify Code & Re-Activate 2FA
                </button>
              </form>
            </div>
          )}

          {/* 2FA Enabled Actions: Reset 2FA via Email OTP OR Disable 2FA via Email OTP */}
          {profile?.is_2fa_enabled && (
            <div className="space-y-4 pt-2 border-t border-slate-800">
              <p className="text-xs text-slate-300">Two-factor authentication is active on your account.</p>

              {!showResetOtpForm && !showDisable2FAOtpForm && (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={handleRequestReset2FAOtp}
                    disabled={resetOtpLoading}
                    className="w-full py-2.5 bg-amber-500/10 border border-amber-500/30 text-amber-300 font-semibold rounded-xl text-sm hover:bg-amber-500/20 transition disabled:opacity-50"
                  >
                    {resetOtpLoading ? 'Sending OTP Email...' : '🔄 Reset 2FA Key (Requires Email OTP)'}
                  </button>

                  <button
                    type="button"
                    onClick={handleRequestDisable2FAOtp}
                    disabled={disable2FAOtpLoading}
                    className="w-full py-2.5 bg-rose-500/10 border border-rose-500/30 text-rose-300 font-semibold rounded-xl text-sm hover:bg-rose-500/20 transition disabled:opacity-50"
                  >
                    {disable2FAOtpLoading ? 'Sending Security Code...' : 'Disable 2FA Security (Requires Email Code)'}
                  </button>
                </div>
              )}

              {/* Form to Confirm Disabling 2FA with Email OTP */}
              {showDisable2FAOtpForm && (
                <form onSubmit={handleConfirmDisable2FAOtp} className="p-4 bg-slate-950 rounded-2xl border border-rose-500/40 space-y-3">
                  <div className="text-left">
                    <h4 className="text-xs font-bold text-rose-300 uppercase">Verify Email Code to Disable 2FA</h4>
                    <p className="text-[11px] text-slate-400">Enter 6-digit code sent to {profile?.email}:</p>
                  </div>

                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={disable2FAOtpCode}
                    onChange={(e) => setDisable2FAOtpCode(e.target.value)}
                    placeholder="123456"
                    className={`w-full px-3.5 py-2.5 bg-slate-800 border rounded-xl text-rose-300 font-mono text-center tracking-widest text-xl focus:outline-none transition-all duration-200 ${
                      disable2FAOtpCode.length > 0 && disable2FAOtpCode.length < 6
                        ? 'border-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.4)]'
                        : 'border-slate-700 focus:ring-2 focus:ring-rose-400'
                    }`}
                  />

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowDisable2FAOtpForm(false)}
                      className="py-2 px-3 bg-slate-800 text-slate-400 text-xs rounded-xl font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={disable2FAOtpLoading || disable2FAOtpCode.length < 6}
                      className="flex-1 py-2 bg-rose-500 text-white font-bold text-xs rounded-xl hover:opacity-95 disabled:opacity-50"
                    >
                      {disable2FAOtpLoading ? 'Verifying...' : 'Verify Code & Disable 2FA'}
                    </button>
                  </div>
                </form>
              )}

              {/* Form to Confirm Resetting 2FA Key with Email OTP */}
              {showResetOtpForm && (
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
                    className={`w-full px-3.5 py-2.5 bg-slate-800 border rounded-xl text-amber-300 font-mono text-center tracking-widest text-xl focus:outline-none transition-all duration-200 ${
                      resetOtpCode.length > 0 && resetOtpCode.length < 6
                        ? 'border-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.4)]'
                        : 'border-slate-700 focus:ring-2 focus:ring-amber-400'
                    }`}
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
