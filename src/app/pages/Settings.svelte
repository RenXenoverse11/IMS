<script>
  import { onDestroy, onMount } from 'svelte';
  import {
    Bell,
    Building,
    Camera,
    Mail,
    Phone,
    Save,
    User,
  } from 'lucide-svelte';
  import { subscribeToCurrentUser, updateProfilePhoto, updateUserProfile } from '../lib/auth.js';

  let saved = false;
  let saveTimer;
  let unsubscribeAuth;

  let currentUser = null;
  let isUploadingPhoto = false;
  let isSavingProfile = false;
  let photoMessage = '';
  let photoError = '';
  let saveError = '';
  let photoInput;

  const MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024;
  const MAX_PROFILE_PHOTO_MB = Math.floor(MAX_PROFILE_PHOTO_BYTES / (1024 * 1024));
  const ALLOWED_PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

  let profile = {
    fullName: '',
    email: '',
    phone: '',
    department: '',
  };

  function toTitleCase(value) {
    const text = String(value || '').trim();
    if (!text) {
      return '';
    }

    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }

  function applyCurrentUserProfile(user) {
    if (!user) {
      return;
    }

    currentUser = user;

    profile = {
      ...profile,
      fullName: String(user.full_name || ''),
      email: String(user.email || ''),
      phone: String(user.phone || ''),
      department: String(user.department || ''),
    };
  }

  function openPhotoPicker() {
    photoError = '';
    photoMessage = '';
    photoInput?.click();
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Unable to read selected image file.'));
      reader.readAsDataURL(file);
    });
  }

  async function handlePhotoChange(event) {
    photoError = '';
    photoMessage = '';

    const files = event?.currentTarget?.files;
    const file = files && files[0];

    if (!file) {
      return;
    }

    if (!currentUser?.user_id) {
      photoError = 'No logged-in user found. Please log in again.';
      event.currentTarget.value = '';
      return;
    }

    if (!ALLOWED_PHOTO_MIME_TYPES.has(String(file.type || '').toLowerCase())) {
      photoError = 'Only JPG, PNG, WEBP, and GIF images are allowed.';
      event.currentTarget.value = '';
      return;
    }

    if (Number(file.size || 0) > MAX_PROFILE_PHOTO_BYTES) {
      photoError = `Image is too large. Maximum file size is ${MAX_PROFILE_PHOTO_MB} MB.`;
      event.currentTarget.value = '';
      return;
    }

    try {
      isUploadingPhoto = true;
      const imageDataUrl = await fileToDataUrl(file);
      await updateProfilePhoto({
        user_id: currentUser.user_id,
        image_data_url: imageDataUrl,
        mime_type: file.type,
        file_name: file.name,
      });
      photoMessage = 'Profile photo updated successfully.';
    } catch (err) {
      photoError = err?.message || 'Unable to upload profile photo right now.';
    } finally {
      isUploadingPhoto = false;
      event.currentTarget.value = '';
    }
  }


  const MAIN_DB_URL = 'https://docs.google.com/spreadsheets/d/1cHfXzp8gRD-x8sVf_j_WtNf-1h_JUqt_O_MOEfBlNVk/edit?pli=1&gid=0#gid=0';
  const IMS_GAS_URL = 'https://script.google.com/home/projects/1DJSac0BqK0YznmpdqlbzhWvcHXDBeMbnQyyDu42sqQTIwS9YFOPTmNSr/edit';
  let copyMessage = '';
  let copyTimer;

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text);
    copyMessage = 'Copied!';
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copyMessage = '';
    }, 2000);
  }


  const profileFields = [
    { key: 'fullName', label: 'Full Name', icon: User, type: 'text' },
    { key: 'email', label: 'Email Address', icon: Mail, type: 'email', readOnly: true },
    { key: 'phone', label: 'Phone Number', icon: Phone, type: 'text' },
    { key: 'department', label: 'Department', icon: Building, type: 'text' },
  ];



  function updateProfileField(key, value) {
    profile = { ...profile, [key]: value };
    saved = false;
    saveError = '';
  }



  async function handleSave() {
    saveError = '';

    if (!currentUser?.user_id) {
      saveError = 'No logged-in user found. Please log in again.';
      return;
    }

    const fullName = String(profile.fullName || '').trim();

    if (!fullName) {
      saveError = 'Please provide your full name.';
      return;
    }

    try {
      isSavingProfile = true;
      await updateUserProfile({
        user_id: currentUser.user_id,
        full_name: fullName,
        phone: profile.phone,
        department: profile.department,
      });

      saved = true;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saved = false;
      }, 2500);
    } catch (err) {
      saveError = err?.message || 'Unable to save profile right now.';
      saved = false;
    } finally {
      isSavingProfile = false;
    }
  }

  function handleCancel() {
    if (currentUser) {
      applyCurrentUserProfile(currentUser);
    }
    saveError = '';
    saved = false;
  }

  onDestroy(() => {
    clearTimeout(saveTimer);
    clearTimeout(copyTimer);
    if (typeof unsubscribeAuth === 'function') {
      unsubscribeAuth();
    }
  });

  onMount(() => {
    unsubscribeAuth = subscribeToCurrentUser((user) => {
      currentUser = user;
      applyCurrentUserProfile(user);
    });
  });

  $: displayName = String(profile.fullName || '').trim() || 'User';
  $: currentUserRole = String(currentUser?.role || '').trim().toLowerCase();
  $: canViewMainDb = currentUserRole === 'admin' || currentUserRole === 'supervisor';
  $: roleLabel = toTitleCase(currentUser?.role) || 'Intern';
  $: displayDepartment = String(profile.department || '').trim();
  $: profileSubtitle = [displayDepartment, roleLabel].filter(Boolean).join(' ');
  $: profilePhotoUrl = String(currentUser?.profile_photo_url || '').trim();
  $: profileInitials = (displayName || 'U')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'U';
</script>

<section class="settings-shell space-y-6">
  <section class="theme-section settings-panel settings-panel-profile rounded-2xl border shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
    <header class="theme-divider border-b px-6 py-4">
      <div class="flex items-center gap-2">
        <User size={16} class="text-indigo-600" />
        <h2 class="theme-heading text-[15px] font-semibold">Profile Information</h2>
      </div>
      <p class="theme-text mt-1 text-[13px]">Update your personal details and public profile.</p>
    </header>

    <div class="px-6 py-5">
      <div class="mb-6 flex items-center gap-4">
        <div class="relative">
          <div class="flex h-16 w-16 items-center justify-center rounded-full bg-linear-to-br from-indigo-500 to-violet-600">
            {#if profilePhotoUrl}
              <img src={profilePhotoUrl} alt={`${displayName} avatar`} class="h-16 w-16 rounded-full object-cover" />
            {:else}
              <span class="text-xl font-bold text-white">{profileInitials}</span>
            {/if}
          </div>
          <button
            type="button"
            class="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-white shadow-md transition-colors hover:bg-indigo-700"
            aria-label="Change profile photo"
            on:click={openPhotoPicker}
            disabled={isUploadingPhoto}
          >
            <Camera size={11} />
          </button>
        </div>

        <input
          bind:this={photoInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          class="hidden"
          on:change={handlePhotoChange}
        />

        <div>
          <p class="theme-heading text-[15px] font-semibold">{displayName}</p>
          <p class="theme-text text-[13px]">{profileSubtitle}</p>
          <button type="button" class="mt-1 text-[13px] font-medium text-indigo-600" on:click={openPhotoPicker} disabled={isUploadingPhoto}>
            {isUploadingPhoto ? 'Uploading photo...' : 'Change photo'}
          </button>
          {#if photoError}
            <p class="mt-1 text-[12px] text-rose-600">{photoError}</p>
          {/if}
          {#if photoMessage}
            <p class="mt-1 text-[12px] text-emerald-600">{photoMessage}</p>
          {/if}
        </div>
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {#each profileFields as field}
          <label class="block">
            <span class="theme-text mb-1.5 block text-[13px]">{field.label}</span>
            <span class="relative block">
              <svelte:component this={field.icon} size={14} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type={field.type}
                value={profile[field.key]}
                on:input={(event) => updateProfileField(field.key, event.currentTarget.value)}
                readonly={field.readOnly === true}
                class="theme-input w-full rounded-xl border py-2.5 pl-9 pr-3 text-[14px] outline-none transition-colors focus:border-indigo-400"
              />
            </span>
          </label>
        {/each}
      </div>
    </div>
  </section>

  {#if canViewMainDb}
    <!-- MAIN_DB Section Section -->
    <section class="theme-section settings-panel settings-panel-database rounded-2xl border">
      <header class="theme-divider border-b px-6 py-4">
        <div class="flex items-center gap-2">
          <Building size={16} class="text-indigo-500" />
          <h2 class="theme-heading text-[15px] font-semibold">MAIN_DB</h2>
        </div>
        <p class="theme-text mt-1 text-[13px]">Access the main database spreadsheet for this project.</p>
      </header>

      <div class="px-6 py-5">
        <div class="mb-4 p-4 rounded-lg settings-link-box border">
          <a
            href={MAIN_DB_URL}
            target="_blank"
            rel="noopener noreferrer"
            class="settings-link text-[13px] font-medium break-all line-clamp-2 hover:underline"
          >
            {MAIN_DB_URL}
          </a>
        </div>

        <button
          type="button"
          on:click={() => copyToClipboard(MAIN_DB_URL)}
          class="settings-btn settings-copy-button rounded-lg px-6 py-2.5 text-[14px] font-medium text-white"
        >
          {copyMessage || 'Copy Link'}
        </button>
      </div>
    </section>

    <!-- NEW: IMS GAS Section -->
    <section class="theme-section settings-panel rounded-2xl border">
      <header class="theme-divider border-b px-6 py-4">
        <div class="flex items-center gap-2">
          <Building size={16} class="text-indigo-500" />
          <h2 class="theme-heading text-[15px] font-semibold">IMS GAS</h2>
        </div>
        <p class="theme-text mt-1 text-[13px]">Access the Google Apps Script project editor.</p>
      </header>

      <div class="px-6 py-5">
        <div class="mb-4 p-4 rounded-lg settings-link-box border">
          <a
            href={IMS_GAS_URL}
            target="_blank"
            rel="noopener noreferrer"
            class="settings-link text-[13px] font-medium break-all line-clamp-2 hover:underline"
          >
            {IMS_GAS_URL}
          </a>
        </div>

        <button
          type="button"
          on:click={() => copyToClipboard(IMS_GAS_URL)}
          class="settings-btn settings-copy-button rounded-lg px-6 py-2.5 text-[14px] font-medium text-white"
        >
          {copyMessage || 'Copy Link'}
        </button>
      </div>
    </section>
  {/if}



  <div class="flex items-center justify-end gap-3">
    <button
      type="button"
      on:click={handleCancel}
      class="settings-btn settings-btn-ghost rounded-xl px-5 py-2.5 text-[14px] font-medium"
      disabled={isSavingProfile}
    >
      Cancel
    </button>
    <button
      type="button"
      on:click={handleSave}
      class="settings-btn settings-btn-primary inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[14px] font-medium text-white"
      class:settings-btn-success={saved}
      disabled={isSavingProfile}
    >
      <Save size={14} />
      {isSavingProfile ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
    </button>
  </div>

  {#if saveError}
    <p class="text-right text-[12px] text-rose-600">{saveError}</p>
  {/if}
</section>

<style>
  .settings-shell {
    --st-surface: #ffffff;
    --st-surface-soft: #f3f8ff;
    --st-border: #d8e2ef;
    --st-heading: #0f172a;
    --st-text: #5f7188;
    --st-muted: #64748b;
    position: relative;
    border-radius: 1.25rem;
    padding: 0.35rem;
    isolation: isolate;
  }

  .settings-shell::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -2;
    border-radius: 1.25rem;
    background: #f6f9fd;
  }

  .settings-shell::after {
    display: none;
  }

  .theme-section {
    background: var(--st-surface);
    border-color: var(--st-border);
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.03), 0 1px 2px rgba(15, 23, 42, 0.05);
  }

  .settings-panel {
    position: relative;
    overflow: hidden;
  }

  .settings-panel::before {
    display: none;
  }

  .theme-divider,
  .theme-border {
    border-color: var(--st-border);
  }

  .theme-input {
    background: #eef5fc;
    border-color: #d8e2ef;
    color: var(--st-heading);
  }

  .theme-input:focus {
    border-color: #3b82f6;
    background: #ffffff;
    box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1);
  }

  .theme-heading {
    color: var(--st-heading);
  }

  .theme-text {
    color: var(--st-text);
  }

  .settings-btn {
    transition: all 0.2s ease;
  }

  .settings-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    box-shadow: none;
  }

  .settings-btn-ghost {
    border: 1px solid #bfd5ec;
    background: #f7fbff;
    color: #355472;
  }

  .settings-btn-ghost:hover:not(:disabled) {
    background: #edf4fb;
    border-color: #9fc2e5;
  }

  .settings-btn-primary,
  .settings-copy-button {
    background: #2563eb;
    border: 1px solid #1d4ed8;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }

  .settings-btn-primary:hover:not(:disabled),
  .settings-copy-button:hover:not(:disabled) {
    background: #1d4ed8;
    transform: translateY(-1px);
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  }

  .settings-btn-success {
    background: #10b981;
    border-color: #059669;
  }

  .settings-link-box {
    background: #eef5fc;
    border-color: #d8e2ef;
  }

  .settings-link {
    color: #0f6cbd;
  }

  .settings-link:hover {
    color: #0a4f8d;
  }

  .settings-copy-note {
    color: #0f766e;
  }

  :global(.dark) .settings-shell {
    --st-surface: #0f1c2f;
    --st-surface-soft: #1e293b;
    --st-border: rgba(255, 255, 255, 0.1);
    --st-heading: #e2e8f0;
    --st-text: #cbd5e1;
    --st-muted: #94a3b8;
  }

  :global(.dark) .settings-shell::before {
    background: #0b111e;
  }

  :global(.dark) .settings-shell::after {
    display: none;
  }

  :global(.dark) .theme-section {
    background: var(--st-surface);
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  }

  :global(.dark) .theme-input {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.1);
    color: #cbd5e1;
  }

  :global(.dark) .theme-input:focus {
    border-color: #3b82f6;
    background: rgba(255, 255, 255, 0.08);
    box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.2);
  }

  :global(.dark) .settings-btn-ghost {
    border-color: rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.05);
    color: #cbd5e1;
  }

  :global(.dark) .settings-btn-ghost:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.15);
  }

  :global(.dark) .settings-link-box {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.1);
  }

  :global(.dark) .settings-link {
    color: #7cc3ff;
  }

  :global(.dark) .settings-link:hover {
    color: #a5d8ff;
  }

  :global(.dark) .settings-copy-note {
    color: #6ee7b7;
  }

  @media (max-width: 768px) {
    .settings-shell {
      border-radius: 1rem;
      padding: 0;
    }
  }
</style>