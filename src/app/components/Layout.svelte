<script>
  import Header from './Header.svelte';
  import Sidebar from './Sidebar.svelte';

  export let currentPath = '/';
  export let pageMeta = { title: 'InternTrack', description: '' };
</script>

<div class="layout-shell">
  <Sidebar {currentPath} />
  <div class="layout-main">
    <Header pageTitle={pageMeta.title} pageDescription={pageMeta.description} />
    <main class="layout-content">
      <slot />
    </main>
  </div>
</div>
