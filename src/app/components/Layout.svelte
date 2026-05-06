<script>
// @ts-nocheck
  import { onDestroy, onMount } from 'svelte';
  import Header from './Header.svelte';
  import Sidebar from './Sidebar.svelte';

  export let currentPath = '/';
  export let pageMeta = { title: 'Internship Management System', description: '' };

  let sidebarCollapsed = false;
  let mobileSidebarOpen = false;
  let isMobileViewport = false;
  let viewportQuery;
  let lastObservedPath = currentPath;

  function syncViewportState(event) {
    isMobileViewport = Boolean(event?.matches ?? viewportQuery?.matches);
    if (!isMobileViewport) {
      mobileSidebarOpen = false;
    }
  }

  function toggleSidebar() {
    if (isMobileViewport) {
      mobileSidebarOpen = !mobileSidebarOpen;
      return;
    }
    sidebarCollapsed = !sidebarCollapsed;
  }

  function closeMobileSidebar() {
    mobileSidebarOpen = false;
  }

  function handleWindowKeydown(event) {
    if (event.key === 'Escape' && mobileSidebarOpen) {
      closeMobileSidebar();
    }
  }

  $: if (isMobileViewport) {
    sidebarCollapsed = false;
  }

  $: if (mobileSidebarOpen) {
    document?.body?.classList?.add('mobile-sidebar-open');
  } else {
    document?.body?.classList?.remove('mobile-sidebar-open');
  }

  $: if (currentPath !== lastObservedPath) {
    if (isMobileViewport && mobileSidebarOpen) {
      closeMobileSidebar();
    }
    lastObservedPath = currentPath;
  }

  onMount(() => {
    viewportQuery = window.matchMedia('(max-width: 960px)');
    syncViewportState(viewportQuery);
    viewportQuery.addEventListener('change', syncViewportState);
    window.addEventListener('keydown', handleWindowKeydown);
  });

  onDestroy(() => {
    viewportQuery?.removeEventListener?.('change', syncViewportState);
    window.removeEventListener('keydown', handleWindowKeydown);
    document?.body?.classList?.remove('mobile-sidebar-open');
  });
</script>

<div
  class="layout-shell"
  class:sidebar-collapsed={sidebarCollapsed}
  class:mobile-layout={isMobileViewport}
  class:mobile-sidebar-open={mobileSidebarOpen}
>
  {#if isMobileViewport}
    <button
      class="mobile-sidebar-backdrop"
      type="button"
      aria-label="Close menu"
      on:click={closeMobileSidebar}
    ></button>
  {/if}

  <Sidebar
    {currentPath}
    collapsed={isMobileViewport ? false : sidebarCollapsed}
    mobileMode={isMobileViewport}
    mobileOpen={mobileSidebarOpen}
    on:toggle={toggleSidebar}
    on:navigate={closeMobileSidebar}
  />
  <div class="layout-main">
    <Header
      pageTitle={pageMeta.title}
      pageDescription={pageMeta.description}
      showMenuButton={isMobileViewport}
      onMenuToggle={toggleSidebar}
    />
    <main class="layout-content">
      <div class="layout-content-inner">
        <slot />
      </div>
    </main>
  </div>
</div>

<style>
  .layout-content-inner {
    box-sizing: border-box;
    min-width: 0;
    min-height: 100%;
    padding: 1.5rem;
  }

  .layout-content-inner > :global(*) {
    min-width: 0;
  }

  .mobile-sidebar-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(2, 6, 23, 0.58);
    border: none;
    opacity: 0;
    pointer-events: none;
    transition: opacity 180ms ease;
    z-index: 140;
  }

  .layout-shell.mobile-sidebar-open .mobile-sidebar-backdrop {
    opacity: 1;
    pointer-events: auto;
  }

  @media (max-width: 720px) {
    .layout-content-inner {
      padding: 1rem 1rem max(1rem, calc(env(safe-area-inset-bottom) + 0.65rem));
    }
  }
</style>
