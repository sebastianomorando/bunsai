import { useEffect, useRef, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { fetchAssets, fetchProfile, updateProfile, uploadAsset } from "../api.ts";
import { t } from "../i18n.ts";
import { assetsState, errorMessage, pendingState, profileState, resetAssetsState, resetUsersState, sessionState, setError, setNotice } from "../state.ts";

export function ProfilePage() {
  const { route } = useLocation();
  const avatarInput = useRef<HTMLInputElement>(null);
  const profile = profileState.value;
  const [username, setUsername] = useState(profile?.username ?? "");
  const [email, setEmail] = useState(profile?.email ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [profileAssetId, setProfileAssetId] = useState<string | null>(profile?.profileAssetId ?? null);

  useEffect(() => {
    if (!sessionState.value) return;
    void Promise.all([fetchProfile(), fetchAssets()]).catch((error) => setError(errorMessage(error)));
  }, [sessionState.value?.userId]);

  useEffect(() => {
    if (!profile) return;
    setUsername(profile.username ?? "");
    setEmail(profile.email ?? "");
    setProfileAssetId(profile.profileAssetId);
  }, [profile?.id, profile?.dateUpdated]);

  if (!sessionState.value) {
    return <div class="panel"><h2>{t("profile.authRequired")}</h2><a class="button" href="/login">{t("users.goToLogin")}</a></div>;
  }

  const ownedImages = assetsState.value.filter((asset) => asset.format && asset.uploadedBy === sessionState.value?.userId);
  const selectedAsset = assetsState.value.find((asset) => asset.id === profileAssetId);
  const avatarUrl = selectedAsset
    ? `${selectedAsset.url}?width=256&height=256&fit=fill&format=webp`
    : profileAssetId === profile?.profileAssetId ? profile?.profileImageUrl : null;

  const onAvatarUpload = async (event: Event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const asset = await uploadAsset(file, t("profile.avatarAssetTitle"));
      if (!asset.format) throw new Error(t("profile.imageRequired"));
      setProfileAssetId(asset.id);
      setNotice(t("profile.avatarReady"));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      if (avatarInput.current) avatarInput.current.value = "";
    }
  };

  const onSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    const emailChanged = email.trim().toLowerCase() !== profile?.email?.toLowerCase();
    const passwordChanged = Boolean(newPassword);
    try {
      await updateProfile({
        username, email, profileAssetId,
        ...(newPassword ? { currentPassword, newPassword } : {}),
      });
      setCurrentPassword("");
      setNewPassword("");
      if (emailChanged || passwordChanged) {
        sessionState.value = null;
        resetUsersState();
        resetAssetsState();
        setNotice(emailChanged ? t("profile.emailConfirmationSent") : t("profile.passwordChanged"));
        route("/login");
      } else {
        setNotice(t("profile.saved"));
      }
    } catch (error) {
      setError(errorMessage(error));
    }
  };

  return (
    <div class="profile-layout">
      <section class="panel profile-avatar-panel">
        <h2>{t("profile.picture")}</h2>
        <div class="profile-avatar">
          {avatarUrl ? <img src={avatarUrl} alt={username} /> : <span>{(username[0] || "?").toUpperCase()}</span>}
        </div>
        <input ref={avatarInput} class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/bmp" onChange={(event) => void onAvatarUpload(event)} />
        <button type="button" class="button" disabled={pendingState.value} onClick={() => avatarInput.current?.click()}>{t("profile.uploadPicture")}</button>
        {ownedImages.length > 0 && <label class="profile-picker">{t("profile.chooseAsset")}<select value={profileAssetId ?? ""} onChange={(event) => setProfileAssetId(event.currentTarget.value || null)}><option value="">{t("profile.noPicture")}</option>{ownedImages.map((asset) => <option key={asset.id} value={asset.id}>{asset.title || asset.filename}</option>)}</select></label>}
        {profileAssetId && <button type="button" class="linklike danger-text" onClick={() => setProfileAssetId(null)}>{t("profile.removePicture")}</button>}
      </section>

      <section class="panel">
        <h2>{t("profile.title")}</h2>
        <form class="form" onSubmit={onSubmit}>
          <label>{t("field.username")}<input required minLength={3} maxLength={255} value={username} onInput={(event) => setUsername(event.currentTarget.value)} /></label>
          <label>{t("field.email")}<input required type="email" maxLength={255} value={email} onInput={(event) => setEmail(event.currentTarget.value)} /></label>
          <div class="profile-password"><h3>{t("profile.passwordTitle")}</h3><p>{t("profile.passwordHint")}</p></div>
          <label>{t("profile.currentPassword")}<input type="password" autoComplete="current-password" value={currentPassword} onInput={(event) => setCurrentPassword(event.currentTarget.value)} /></label>
          <label>{t("profile.newPassword")}<input type="password" minLength={8} autoComplete="new-password" value={newPassword} onInput={(event) => setNewPassword(event.currentTarget.value)} /></label>
          <button type="submit" class="button" disabled={pendingState.value || !username || !email || (!!newPassword && !currentPassword)}>{pendingState.value ? t("profile.saving") : t("profile.save")}</button>
        </form>
      </section>
    </div>
  );
}
