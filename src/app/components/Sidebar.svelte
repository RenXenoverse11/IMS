<script>
  import {
    ChevronDown,
    Clock,
    FileText,
    HelpCircle,
    KeyRound,
    LayoutDashboard,
    LogOut,
    Settings,
    Star,
    User,
  } from 'lucide-svelte';

  export let currentPath = '/';

  const navItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/time-log', label: 'Time Log', icon: Clock },
    { path: '/documents', label: 'Activity Log', icon: FileText },
    { path: '/evaluation', label: 'Evaluation', icon: Star },
    { path: '/settings', label: 'Settings', icon: Settings },
  ];

  let profileOpen = false;

  function goTo(path) {
    window.location.hash = path;
    profileOpen = false;
  }

  function toggleProfile() {
    profileOpen = !profileOpen;
  }
</script>

<aside class="sidebar">
  <div class="sidebar-brand">
    <div class="brand-mark">IMS</div>
    <span>InternTrack</span>
  </div>

  <nav class="sidebar-nav">
    <p class="sidebar-label">Main Menu</p>
    <ul>
      {#each navItems as item (item.path)}
        <li>
          <button
            class:active={currentPath === item.path}
            class="nav-button"
            type="button"
            on:click={() => goTo(item.path)}
          >
            <svelte:component this={item.icon} size={17} />
            <span>{item.label}</span>
            {#if currentPath === item.path}
              <span class="nav-dot"></span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>

    <div class="sidebar-footer-links">
      <button class="nav-button nav-button-logout" type="button" on:click={() => goTo('/')}>
        <LogOut size={17} />
        <span>Sign Out</span>
      </button>
    </div>
  </nav>

  <div class="sidebar-profile">
    <div class="sidebar-profile-shell">
      <button class="sidebar-profile-button" type="button" on:click={toggleProfile}>
        <div class="avatar">AJ</div>
        <div class="sidebar-profile-copy">
          <p>Alex Johnson</p>
          <span>Intern</span>
        </div>
        <ChevronDown size={14} class={profileOpen ? 'rotate-180' : ''} />
      </button>

      {#if profileOpen}
        <div class="sidebar-profile-menu">
          <button class="menu-item" type="button" on:click={() => goTo('/settings')}>
            <User size={14} />
            <span>Profile Settings</span>
          </button>
          <button class="menu-item" type="button" on:click={() => goTo('/settings')}>
            <KeyRound size={14} />
            <span>Change Password</span>
          </button>
          <button class="menu-item" type="button" on:click={toggleProfile}>
            <HelpCircle size={14} />
            <span>Help & Support</span>
          </button>
          <div class="menu-divider"></div>
          <button class="menu-item danger" type="button" on:click={toggleProfile}>
            <LogOut size={14} />
            <span>Sign Out</span>
          </button>
        </div>
      {/if}
    </div>
  </div>
</aside>
