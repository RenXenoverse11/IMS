<script>
  // @ts-nocheck
  import { Loader2, Trash2 } from 'lucide-svelte';

  export let item = null;
  export let projectId = '';
  export let depth = 0;
  export let replyingTo = {};
  export let replyText = {};
  export let replySubmitting = {};
  export let currentUser = null;
  export let getCurrentUser = () => null;
  export let getChildren = () => [];
  export let resolveUserName = (userId) => String(userId || '').trim();
  export let onToggleReply = () => {};
  export let onReplyText = () => {};
  export let onSubmitReply = () => {};
  export let onCancelReply = () => {};
  export let onDelete = () => {};

  $: itemId = String(item?.feedback_id || item?.id || '').trim();
  $: commenterId = String(item?.commenter_id || '').trim();
  $: resolvedName = String(resolveUserName(item?.commenter_id) || '').trim();
  $: commenterName = String(
    item?.commenter_name ||
    item?.commenter ||
    (resolvedName && resolvedName !== commenterId ? resolvedName : '') ||
    'Unknown user'
  ).trim();
  $: currentUserId = String(currentUser?.user_id || getCurrentUser()?.user_id || '').trim();
  $: canDelete = commenterId === currentUserId;
</script>

<div class={depth === 0 ? 'feedback-thread' : 'feedback-reply'} style={depth > 0 ? `margin-left:${depth * 1.1}rem` : ''}>
    <div class="feedback-card">
      <div class="feedback-card-top">
      <span class="fb-role-badge" class:fb-badge-sup={String(item?.commenter_role || '').trim() === 'Supervisor'}>{commenterName}</span>
      <div style="flex:1"></div>
      {#if canDelete}
        <button class="icon-btn fb-delete-btn" title="Delete" on:click={() => onDelete(projectId, itemId)}><Trash2 size={13} /></button>
      {/if}
    </div>

    <div class="fb-comment-text">{item?.comment_text}</div>

    <div class="fb-actions">
      <button class="fb-reply-btn" on:click={() => onToggleReply(projectId, itemId)}>↩ Reply</button>
    </div>

    {#if replyingTo?.[projectId] === itemId}
      <div class="fb-reply-compose">
        <textarea
          class="fb-reply-input"
          rows="2"
          placeholder="Write a reply..."
          value={replyText?.[projectId] || ''}
          on:input={(e) => onReplyText(projectId, e.currentTarget.value)}
        ></textarea>
        <div class="fb-action-btns">
          <button class="fb-send-btn" class:fb-send-btn-busy={!!replySubmitting?.[projectId]} disabled={!!replySubmitting?.[projectId]} on:click={() => onSubmitReply(projectId, itemId)}>
            {#if replySubmitting?.[projectId]}
              <Loader2 size={13} class="spin" />
              <span>Sending...</span>
            {:else}
              <span>Send</span>
            {/if}
          </button>
          <button class="fb-cancel-btn" on:click={() => onCancelReply(projectId)}>Cancel</button>
        </div>
      </div>
    {/if}
  </div>

  {#each getChildren(projectId, itemId) as child (child.feedback_id || child.id)}
    <svelte:self
      item={child}
      {projectId}
      depth={depth + 1}
      {replyingTo}
      {replyText}
      {replySubmitting}
      {currentUser}
      {getCurrentUser}
      {getChildren}
      {resolveUserName}
      {onToggleReply}
      {onReplyText}
      {onSubmitReply}
      {onCancelReply}
      {onDelete}
    />
  {/each}
</div>

<style>
  .feedback-thread {
    border: 1px solid var(--color-border);
    border-radius: 10px;
    overflow: hidden;
    background: var(--color-surface);
  }

  .feedback-reply {
    border-top: 1px solid var(--color-border);
    background: rgba(0, 0, 0, 0.02);
    padding: 0.6rem 1rem 0.6rem 1.5rem;
  }

  :global(body.dark) .feedback-thread {
    background: #0f1720;
    border-color: #ffffff0e;
  }

  :global(body.dark) .feedback-reply {
    background: rgba(255, 255, 255, 0.02);
    border-top-color: #ffffff10;
  }

  .feedback-card {
    padding: 0.75rem 1rem 0.6rem;
  }

  .feedback-card-top {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.4rem;
  }

  .fb-role-badge {
    font-size: 0.72rem;
    font-weight: 700;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    background: rgba(99, 102, 241, 0.12);
    color: #6366f1;
    border: 1px solid rgba(99, 102, 241, 0.2);
    font-family: inherit;
  }

  .fb-badge-sup {
    background: rgba(16, 185, 129, 0.12);
    color: #059669;
    border-color: rgba(16, 185, 129, 0.22);
  }

  .fb-comment-text {
    font-size: 0.88rem;
    font-family: inherit;
    color: var(--color-text);
    line-height: 1.55;
    white-space: pre-wrap;
  }

  .fb-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
    flex-wrap: wrap;
  }

  .fb-reply-btn {
    font-size: 0.78rem;
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 0.4rem;
    color: var(--color-sidebar-text);
    cursor: pointer;
    padding: 0.22rem 0.55rem;
    font-family: inherit;
    transition: background 0.15s;
  }

  .fb-reply-btn:hover {
    background: var(--color-hover);
    color: var(--color-heading);
  }

  .fb-reply-compose {
    padding: 0.55rem 1rem 0.6rem 1.5rem;
    border-top: 1px solid var(--color-border);
    background: rgba(0, 0, 0, 0.015);
  }

  :global(body.dark) .fb-reply-compose {
    background: rgba(255, 255, 255, 0.015);
  }

  .fb-reply-input {
    resize: vertical;
    width: 100%;
    font-size: 0.82rem;
    font-family: inherit;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-surface);
    color: var(--color-heading);
    padding: 0.4rem 0.6rem;
    outline: none;
    margin-bottom: 6px;
    box-sizing: border-box;
  }

  .fb-reply-input:focus {
    border-color: #3b82f6;
  }

  .fb-action-btns {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .fb-send-btn,
  .fb-cancel-btn {
    font-size: 0.78rem;
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 0.4rem;
    color: var(--color-sidebar-text);
    cursor: pointer;
    padding: 0.22rem 0.55rem;
    font-family: inherit;
    transition: background 0.15s;
  }

  .fb-send-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .fb-send-btn:hover,
  .fb-cancel-btn:hover {
    background: var(--color-hover);
    color: var(--color-heading);
  }

  .fb-send-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    background: var(--color-surface);
    border-color: var(--color-border);
    color: var(--color-sidebar-text);
  }

  .fb-send-btn.fb-send-btn-busy,
  .fb-send-btn.fb-send-btn-busy:disabled {
    opacity: 1;
    background: transparent;
    border-color: var(--color-border);
    color: var(--color-sidebar-text);
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 6px;
    border-radius: 8px;
    margin: 0;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    color: var(--color-accent);
    cursor: pointer;
    transition: transform 0.12s, background 0.12s, border-color 0.12s;
  }

  .icon-btn:hover {
    background: color-mix(in srgb, var(--color-accent) 12%, var(--color-surface));
    border-color: var(--color-accent);
    transform: translateY(-1px);
  }

  .icon-btn:disabled {
    opacity: 0.65;
    cursor: not-allowed;
    transform: none;
    background: var(--color-surface);
    border-color: var(--color-border);
    color: var(--color-sidebar-text);
  }

  .fb-delete-btn {
    color: #ef4444 !important;
    border-color: rgba(239, 68, 68, 0.38) !important;
    background: rgba(239, 68, 68, 0.08) !important;
    transition: opacity 0.16s ease, transform 0.12s ease, filter 0.16s ease;
  }

  .fb-delete-btn:hover:not(:disabled) {
    border-color: rgba(239, 68, 68, 0.62) !important;
    background: rgba(239, 68, 68, 0.14) !important;
    opacity: 0.9;
  }

  .icon-btn :global(svg) {
    display: block;
  }
</style>
