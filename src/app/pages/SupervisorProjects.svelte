<script>
// @ts-nocheck
  import { onMount, onDestroy } from 'svelte';
  import { getCurrentUser, subscribeToCurrentUser, callApiAction } from '../lib/auth.js';
  import { FolderOpen, Clock3, Tag, Users2, CalendarDays, Loader2, Grid, Archive, RotateCcw, Eye, ExternalLink, Link2, Download, Trash2, Pencil } from 'lucide-svelte';

  export let currentUser = null;

  let allProjects = [];
  let isLoading = false;
  let loadError = '';
  let filterPriority = 'all';
  let filterStatus = 'all';
  let filterIntern = 'all';
  let searchQuery = '';
  let activeView = 'Overview';
  // Inline collapsed project detail state (for supervisor view)
  let viewingProjectId = null;
  let viewingProjectTab = 'Details';
  let feedbackMap = {};
  let feedbackLoading = {};
  let newFeedbackText = {};
  // expand/collapse for description in read view
  let expandedDescriptionId = null;
  // Folder-based Submissions (copied concept from ProjectsIntern)
  let expandedFolderIds  = new Set();
  let activeLinkFolderId = null;
  let viewingLinkUrl     = '';
  let viewingLinkLabel   = '';
  let renamingFolderId   = null;
  let renamingFolderName = '';
  let pendingUpload      = { projectId: null, folderId: null, file: null, name: '', type: 'Document', ext: '' };
  let isLoadingFolders   = false;
  let isSavingFolder     = false;
  let isUploadingFile    = false;
  let formError = '';
  let formSuccess = '';
  const FILE_TYPE_OPTIONS = ['Document', 'Powerpoint', 'PDF', 'Word'];

  function extToKind_(ext) {
    const e = String(ext || '').toLowerCase().replace('.', '');
    if (e === 'pdf')  return 'PDF';
    if (['ppt','pptx'].includes(e)) return 'Powerpoint';
    if (['doc','docx'].includes(e)) return 'Document';
    return 'Document';
  }

  function extToMime_(ext) {
    const e = String(ext || '').toLowerCase().replace('.', '');
    const map = {
      pdf: 'application/pdf',
      doc:  'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ppt:  'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      xls:  'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      png:  'image/png',
      jpg:  'image/jpeg',
      jpeg: 'image/jpeg',
      gif:  'image/gif',
      html: 'text/html',
      txt:  'text/plain',
    };
    return map[e] || 'application/octet-stream';
  }

  function toggleFolder(folderId) {
    if (expandedFolderIds.has(folderId)) { expandedFolderIds.delete(folderId); }
    else { expandedFolderIds.add(folderId); }
    expandedFolderIds = new Set(expandedFolderIds);
  }

  function toggleLinkPanel(folderId) {
    if (activeLinkFolderId === folderId) {
      activeLinkFolderId = null;
      viewingLinkUrl = '';
      viewingLinkLabel = '';
      formError = '';
    } else {
      activeLinkFolderId = folderId;
      viewingLinkUrl = '';
      viewingLinkLabel = '';
      formError = '';
    }
  }

  function triggerFilePicker(projectId, folderId) {
    const el = document.getElementById(`proj-file-input-${projectId}-${folderId}`);
    if (el) el.click();
  }

  function handleFileSelect(projectId, folderId, ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const defaultName = file.name.replace(/\.[^/.]+$/, '');
    const ext = (file.name.match(/\.([^.]+)$/) || [])[1] || '';
    pendingUpload = { projectId, folderId, file, name: defaultName, type: extToKind_(ext), ext };
    ev.target.value = '';
  }

  function cancelPendingUpload() {
    pendingUpload = { projectId: null, folderId: null, file: null, name: '', type: 'Document', ext: '' };
    formError = '';
  }

  async function confirmUpload(projectId, folderId) {
    if (!pendingUpload || pendingUpload.projectId !== projectId || pendingUpload.folderId !== folderId || !pendingUpload.file) return;
    const file = pendingUpload.file;
    const chosenName = (String(pendingUpload.name || '').trim() || file.name.replace(/\.[^/.]+$/, '')) + (pendingUpload.ext ? '.' + pendingUpload.ext : '');
    const chosenKind = pendingUpload.type || 'Document';
    const ext = pendingUpload.ext || (file.name.match(/\.([^.]+)$/) || [])[1] || '';
    const mimeType = extToMime_(ext);
    const fileSizeMb = (file.size / (1024 * 1024)).toFixed(3);
    const projObj = allProjects.find(p => p.id === String(projectId));
    const projId = String(projObj?.proj_id || projectId);
    const uid = String(currentUser?.user_id || getCurrentUser()?.user_id || '');
    isUploadingFile = true;
    formError = '';
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result;
          const b64 = (dataUrl || '').split(',')[1] || '';
          resolve(b64);
        };
        reader.onerror = () => reject(new Error('File read failed'));
        reader.readAsDataURL(file);
      });

      const res = await callApiAction('create_proj_submission', {
        proj_id: projId,
        folder_id: folderId,
        user_id: uid,
        kind: 'file',
        file_name: chosenName,
        file_type: ext,
        file_kind: chosenKind,
        file_size: fileSizeMb,
        base64_data: base64,
        mime_type: mimeType
      });

      if (!res?.ok) { formError = res?.error || 'Upload failed.'; return; }

      const folderGdrive = allProjects.find(p => p.id === projectId)?.folders?.find(f => f.id === folderId)?.gdrive_link || '';
      const submission = {
        id: res.submission_id,
        submission_id: res.submission_id,
        kind: 'file',
        name: chosenName,
        file_type: ext,
        file_size: (String(fileSizeMb || '').trim() && !/\s*MB$/i.test(String(fileSizeMb || ''))) ? String(fileSizeMb) + ' MB' : String(fileSizeMb || ''),
        uploaded_at: res.uploaded_at || new Date().toISOString().slice(0,10),
        drive_url: res.drive_url || '',
        gdrive: folderGdrive
      };
      allProjects = allProjects.map(p => p.id === projectId ? {
        ...p,
        folders: (p.folders || []).map(f => f.id === folderId ? { ...f, submissions: [...(f.submissions || []), submission] } : f)
      } : p);
      formSuccess = 'File uploaded successfully.';
      setTimeout(() => { formSuccess = ''; }, 3000);
      cancelPendingUpload();
    } catch (e) {
      formError = e?.message || 'Upload failed.';
    } finally {
      isUploadingFile = false;
    }
  }

  async function addLinkSubmission(projectId, folderId) {
    if (!String(viewingLinkUrl || '').trim()) { formError = 'Link URL is required.'; return; }
    const projObj = allProjects.find(p => p.id === String(projectId));
    const projId = String(projObj?.proj_id || projectId);
    const uid = String(currentUser?.user_id || getCurrentUser()?.user_id || '');
    formError = '';
    try {
      const res = await callApiAction('create_proj_submission', {
        proj_id: projId,
        folder_id: folderId,
        user_id: uid,
        kind: 'link',
        link_label: viewingLinkLabel,
        link_url: viewingLinkUrl
      });
      if (!res?.ok) { formError = res?.error || 'Failed to save link.'; return; }
      const submission = {
        id: res.submission_id,
        submission_id: res.submission_id,
        kind: 'link',
        title: viewingLinkLabel || viewingLinkUrl,
        url: viewingLinkUrl,
        added_at: res.uploaded_at || new Date().toISOString()
      };
      allProjects = allProjects.map(p => p.id === projectId ? {
        ...p,
        folders: (p.folders || []).map(f => f.id === folderId ? { ...f, submissions: [...(f.submissions || []), submission] } : f)
      } : p);
      viewingLinkUrl = '';
      viewingLinkLabel = '';
      activeLinkFolderId = null;
      formSuccess = 'Link added.';
      setTimeout(() => { formSuccess = ''; }, 2000);
    } catch (e) {
      formError = e?.message || 'Failed to save link.';
    }
  }

  async function viewSubmission(sub) {
    if (!sub) return;
    const popup = window.open('about:blank', '_blank');
    let url = sub.kind === 'file' ? (sub.drive_url || '') : (sub.url || '');
    if (sub.kind === 'file' && !url) {
      try {
        const res = await callApiAction('get_submission_drive_url', {
          submission_id: sub.submission_id,
          folder_id: sub.folder_id || '',
          file_name: sub.name || '',
          gdrive: sub.gdrive || ''
        });
        if (res?.ok && res.drive_url) {
          url = res.drive_url;
          sub.drive_url = url;
        }
      } catch (e) {}
    }
    if (!url) {
      popup?.close();
      return;
    }
    if (sub.kind === 'file') {
      const m = String(url || '').match(/\/d\/([a-zA-Z0-9_-]+)/) || String(url || '').match(/[?&]id=([a-zA-Z0-9_-]+)/);
      const fid = m ? m[1] : null;
      if (fid) {
        const viewUrl = 'https://drive.google.com/file/d/' + fid + '/view?usp=sharing';
        popup.location.href = viewUrl;
        return;
      }
    }
    popup.location.href = url;
  }

  async function downloadSubmission(sub) {
    if (!sub) return;
    const popup = window.open('about:blank', '_blank');
    let url = sub.kind === 'file' ? (sub.drive_url || '') : (sub.url || '');
    if (sub.kind === 'file' && !url) {
      try {
        const res = await callApiAction('get_submission_drive_url', {
          submission_id: sub.submission_id,
          folder_id: sub.folder_id || '',
          file_name: sub.name || '',
          gdrive: sub.gdrive || ''
        });
        if (res?.ok && res.drive_url) {
          url = res.drive_url;
          sub.drive_url = url;
        }
      } catch (e) {}
    }
    if (!url) {
      popup?.close();
      return;
    }
    if (sub.kind === 'file') {
      const m = String(url || '').match(/\/d\/([a-zA-Z0-9_-]+)/) || String(url || '').match(/[?&]id=([a-zA-Z0-9_-]+)/);
      const fid = m ? m[1] : null;
      if (fid) {
        const dl = 'https://drive.google.com/uc?export=download&id=' + fid;
        popup.location.href = dl;
        return;
      }
    }
    popup.location.href = url;
  }

  async function deleteSubmission(projectId, folderId, subId) {
    allProjects = allProjects.map(p => p.id === projectId ? {
      ...p,
      folders: (p.folders || []).map(f => f.id === folderId ? { ...f, submissions: (f.submissions || []).filter(s => s.id !== subId) } : f)
    } : p);
    try {
      const res = await callApiAction('delete_proj_submission', { submission_id: subId });
      if (!res?.ok) { setFlashError(res?.error || 'Delete submission failed.'); return; }
      setFlashMessage('Submission removed.');
    } catch (e) { setFlashError(e?.message || 'Delete submission failed.'); }
  }

  async function addFolder(projectId) {
    const uid = String(currentUser?.user_id || getCurrentUser()?.user_id || '');
    const projObj = allProjects.find(p => p.id === projectId);
    const projId = String(projObj?.proj_id || projectId);
    isSavingFolder = true;
    try {
      const res = await callApiAction('create_proj_folder', { proj_id: projId, folder_name: 'New Folder', user_id: uid });
      if (!res?.ok) { setFlashError(res?.error || 'Failed to create folder.'); return; }
      const newFolder = { id: res.folder_id, folder_id: res.folder_id, name: 'New Folder', gdrive_link: res.gdrive_link || '', submissions: [] };
      allProjects = allProjects.map(p => p.id === projectId ? { ...p, folders: [...(p.folders || []), newFolder] } : p);
      expandedFolderIds.add(res.folder_id);
      expandedFolderIds = new Set(expandedFolderIds);
      renamingFolderId = res.folder_id;
      renamingFolderName = 'New Folder';
    } catch (e) { setFlashError(e?.message || 'Failed to create folder.'); }
    finally { isSavingFolder = false; }
  }

  function startRenaming(folderId, currentName) {
    renamingFolderId = folderId;
    renamingFolderName = currentName;
  }

  async function confirmRename(projectId) {
    if (!renamingFolderId) return;
    const newName = String(renamingFolderName || '').trim() || 'New Folder';
    const uid = String(currentUser?.user_id || getCurrentUser()?.user_id || '');
    const savedId = renamingFolderId;
    renamingFolderId = null;
    renamingFolderName = '';
    allProjects = allProjects.map(p => p.id === projectId ? { ...p, folders: (p.folders || []).map(f => f.id === savedId ? { ...f, name: newName } : f) } : p);
    try {
      const res = await callApiAction('update_proj_folder', { folder_id: savedId, folder_name: newName, user_id: uid });
      if (!res?.ok) { setFlashError(res?.error || 'Rename failed.'); }
    } catch (e) { setFlashError(e?.message || 'Rename failed.'); }
  }

  async function deleteFolder(projectId, folderId) {
    if (activeLinkFolderId === folderId) activeLinkFolderId = null;
    if (pendingUpload.folderId === folderId) cancelPendingUpload();
    allProjects = allProjects.map(p => p.id === projectId ? { ...p, folders: (p.folders || []).filter(f => f.id !== folderId) } : p);
    expandedFolderIds.delete(folderId);
    expandedFolderIds = new Set(expandedFolderIds);
    try {
      const res = await callApiAction('delete_proj_folder', { folder_id: folderId });
      if (!res?.ok) { setFlashError(res?.error || 'Delete folder failed.'); return; }
      setFlashMessage('Folder deleted.');
    } catch (e) { setFlashError(e?.message || 'Delete folder failed.'); }
  }
  // Milestones + Feedback state and helpers (adapted from ProjectsIntern)
  let newMilestoneInputs = {};
  let editingMilestoneId = null;
  let editingMilestoneInputs = {};
  let showAddMilestoneFor = {};

  let expandedMilestoneIds = new Set();
  let milestoneFilePicker  = {};  // { [milestoneId]: boolean }

  function toggleMilestoneExpand(milestoneId) {
    if (expandedMilestoneIds.has(milestoneId)) expandedMilestoneIds.delete(milestoneId);
    else expandedMilestoneIds.add(milestoneId);
    expandedMilestoneIds = new Set(expandedMilestoneIds);
  }

  function toggleMilestoneFilePicker(milestoneId) {
    milestoneFilePicker = { ...milestoneFilePicker, [milestoneId]: !milestoneFilePicker[milestoneId] };
  }

  function parseMilestoneFiles(m) {
    try { const v = m.linked_files || ''; if (!v) return []; return JSON.parse(v); } catch(e) { return []; }
  }

  function projectFileSubmissions(projectId) {
    const proj = allProjects.find(p => p.id === projectId);
    if (!proj || !proj.folders) return [];
    const files = [];
    for (const folder of proj.folders) {
      for (const s of (folder.submissions || [])) {
        if (s.kind === 'file') files.push({ ...s, folder_name: folder.name });
      }
    }
    return files;
  }

  function toggleAddMilestone(projectId) {
    const init = newMilestoneInputs[projectId] || { milestone: '', date: '' };
    newMilestoneInputs = { ...newMilestoneInputs, [projectId]: init };
    showAddMilestoneFor = { ...showAddMilestoneFor, [projectId]: !Boolean(showAddMilestoneFor[projectId]) };
  }

  async function createMilestone(projectId) {
    formError = '';
    const proj = allProjects.find(p => p.id === projectId);
    if (!proj) return;
    const projId = String(proj.proj_id || projectId);
    const inputs = newMilestoneInputs[projectId] || { milestone: '', date: '' };
    const text = String(inputs.milestone || '').trim();
    const date = String(inputs.date || '').trim();
    if (!text) { formError = 'Milestone text is required.'; return; }
    const uid = String(currentUser?.user_id || getCurrentUser()?.user_id || '');
    try {
      const res = await callApiAction('create_milestone', { proj_id: projId, milestone: text, date: date, status: 'Not Started', done: false, user_id: uid });
      if (!res?.ok) { formError = res?.error || 'Failed to create milestone.'; return; }
      const item = { id: res.milestone_id, milestone: text, date: date, status: 'Not Started', created_at: res.created_at, created_by: uid, done: false };
      allProjects = allProjects.map(p => p.id === projectId ? { ...p, milestones: [ ...(p.milestones || []), item ] } : p);
      newMilestoneInputs = { ...newMilestoneInputs, [projectId]: { milestone: '', date: '' } };
      showAddMilestoneFor = { ...showAddMilestoneFor, [projectId]: false };
      formSuccess = 'Milestone added.';
      setTimeout(() => { formSuccess = ''; }, 2000);
    } catch (e) { formError = e?.message || 'Failed to create milestone.'; }
  }

  async function deleteMilestone(projectId, milestoneId) {
    if (!milestoneId) return;
    allProjects = allProjects.map(p => p.id === projectId ? { ...p, milestones: (p.milestones || []).filter(m => m.id !== milestoneId) } : p);
    try {
      const res = await callApiAction('delete_milestone', { milestone_id: milestoneId });
      if (!res?.ok) { setFlashError(res?.error || 'Failed to delete milestone.'); return; }
      setFlashMessage('Milestone deleted.');
      setTimeout(() => { }, 1500);
    } catch (e) { setFlashError(e?.message || 'Failed to delete milestone.'); }
  }

  function startEditMilestone(projectId, m) {
    editingMilestoneId = m.id;
    editingMilestoneInputs = { ...editingMilestoneInputs, [m.id]: { milestone: m.milestone || '', date: m.date || '', status: m.status || 'Not Started' } };
  }

  function cancelEditMilestone() { editingMilestoneId = null; }

  async function saveEditedMilestone(projectId, milestoneId) {
    if (!milestoneId) return;
    const inputs = editingMilestoneInputs[milestoneId] || { milestone: '', date: '' };
    const text = String(inputs.milestone || '').trim();
    const date = String(inputs.date || '').trim();
    if (!text) { formError = 'Milestone text is required.'; return; }
    const uid = String(currentUser?.user_id || getCurrentUser()?.user_id || '');
    try {
      const res = await callApiAction('update_milestone', { milestone_id: milestoneId, milestone: text, date: date, status: String(inputs.status || 'Not Started'), user_id: uid });
      if (!res?.ok) { formError = res?.error || 'Failed to update milestone.'; return; }
      try { await loadProjectMilestones(projectId); } catch (e) { allProjects = allProjects.map(p => p.id === projectId ? { ...p, milestones: (p.milestones || []).map(mm => mm.id === milestoneId ? { ...mm, milestone: text, date: date, status: String(inputs.status || 'Not Started') } : mm) } : p); }
      editingMilestoneId = null;
      formSuccess = 'Milestone updated.';
      setTimeout(() => { formSuccess = ''; }, 1500);
    } catch (e) { formError = e?.message || 'Failed to update milestone.'; }
  }

  async function changeMilestoneStatus(projectId, milestoneId, newStatus) {
    if (!milestoneId) return;
    const uid = String(currentUser?.user_id || getCurrentUser()?.user_id || '');
    try {
      const res = await callApiAction('update_milestone', { milestone_id: milestoneId, status: String(newStatus || 'Not Started'), user_id: uid });
      if (!res?.ok) { setFlashError(res?.error || 'Failed to update status.'); return; }
      allProjects = allProjects.map(p => p.id === projectId ? { ...p, milestones: (p.milestones || []).map(mm => mm.id === milestoneId ? { ...mm, status: String(newStatus || 'Not Started'), done: (String(newStatus || '').toLowerCase() === 'approved' || Boolean(mm.done)) } : mm) } : p);
      try { await loadProjectMilestones(projectId); } catch (e) {}
      setFlashMessage('Status updated.');
    } catch (e) { setFlashError(e?.message || 'Failed to update status.'); }
  }

  async function toggleMilestoneFile(projectId, milestoneId, submission) {
    const proj = allProjects.find(p => p.id === projectId);
    if (!proj) return;
    const m = (proj.milestones || []).find(x => x.id === milestoneId);
    if (!m) return;
    const current = parseMilestoneFiles(m);
    const exists = current.find(f => f.id === submission.id);
    const updated = exists ? current.filter(f => f.id !== submission.id) : [...current, { id: submission.id, name: submission.name, drive_url: submission.drive_url || '' }];
    const linkedJson = JSON.stringify(updated);
    const uid = String(currentUser?.user_id || getCurrentUser()?.user_id || '');
    try {
      const res = await callApiAction('update_milestone', { milestone_id: milestoneId, linked_files: linkedJson, user_id: uid });
      if (!res?.ok) { formError = res?.error || 'Failed to update linked files.'; return; }
      allProjects = allProjects.map(proj2 => proj2.id !== projectId ? proj2 : { ...proj2, milestones: (proj2.milestones || []).map(mm => mm.id === milestoneId ? { ...mm, linked_files: linkedJson } : mm) });
    } catch (e) { formError = e?.message || 'Failed to update linked files.'; }
  }

  // Feedback helpers
  let replyingTo = {};
  let replyText = {};

  function feedbackChildren(projectId, parentId) {
    const list = feedbackMap[projectId] || [];
    return list.filter(f => String(f.parent_id || '') === String(parentId || ''));
  }

  async function submitFeedback(projectId) {
    const text = String(newFeedbackText[projectId] || '').trim();
    if (!text) return;
    const uid  = String(currentUser?.user_id || getCurrentUser()?.user_id || '');
    const role = String(currentUser?.role || getCurrentUser()?.role || 'Supervisor');
    try {
      const res = await callApiAction('create_feedback', { proj_id: String(projectId), user_id: uid, commenter_role: role, comment_text: text });
      if (!res?.ok) { setFlashError(res?.error || 'Failed to post comment.'); return; }
      newFeedbackText = { ...newFeedbackText, [projectId]: '' };
      await loadFeedback(projectId);
    } catch (e) { setFlashError(e?.message || 'Failed to post comment.'); }
  }

  async function submitReply(projectId, parentId) {
    const text = String(replyText[projectId] || '').trim();
    if (!text) return;
    const uid  = String(currentUser?.user_id || getCurrentUser()?.user_id || '');
    const role = String(currentUser?.role || getCurrentUser()?.role || 'Supervisor');
    try {
      const res = await callApiAction('create_feedback', { proj_id: String(projectId), parent_id: String(parentId), user_id: uid, commenter_role: role, comment_text: text });
      if (!res?.ok) { setFlashError(res?.error || 'Failed to post reply.'); return; }
      replyText    = { ...replyText,    [projectId]: '' };
      replyingTo   = { ...replyingTo,   [projectId]: null };
      await loadFeedback(projectId);
    } catch (e) { setFlashError(e?.message || 'Failed to post reply.'); }
  }

  async function deleteFeedback(projectId, feedbackId) {
    const uid = String(currentUser?.user_id || getCurrentUser()?.user_id || '');
    try {
      const res = await callApiAction('delete_feedback', { feedback_id: feedbackId, user_id: uid });
      if (!res?.ok) { setFlashError(res?.error || 'Delete failed.'); return; }
      await loadFeedback(projectId);
    } catch (e) { setFlashError(e?.message || 'Delete failed.'); }
  }
  // user bootstrap and lookup (map user_id -> display name)
  let users = [];
  let userMap = {};
  let unsubscribeAuth;

  function toggleDescription(projectId) {
    expandedDescriptionId = expandedDescriptionId === projectId ? null : projectId;
  }

  function buildUserMap(list) {
    const map = {};
    (Array.isArray(list) ? list : []).forEach(u => {
      const id = String(u?.user_id || u?.id || u?.UserId || u?.userId || u?.email || '').trim();
      const name = String(u?.full_name || u?.name || u?.fullName || u?.displayName || u?.email || id).trim();
      if (id) map[id] = name;
    });
    return map;
  }
  let supervisorLabel = 'your supervisor account';
  let actionMessage = '';
  let actionError = '';
  let flashTimer;

  const PRIORITY_OPTIONS = ['Low', 'Medium', 'High'];
  const STATUS_OPTIONS = ['Not Started', 'In Progress', 'Submitted', 'Needs Revision', 'Approved'];

  const DEFAULT_PRIORITY_COLOR = { bg: '#eef2f7', text: '#475569', border: '#cbd5e1' };
  const PRIORITY_COLORS = {
    'Low': { bg: '#f0f9ff', text: '#0369a1', border: '#bae6fd' },
    'Medium': { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
    'High': { bg: '#fff1f2', text: '#b91c1c', border: '#fecaca' }
  };

  const STATUS_META = {
    'Not Started': { cls: 'status-not-started', label: 'Not Started' },
    'In Progress': { cls: 'status-in-progress', label: 'In Progress' },
    'Submitted': { cls: 'status-submitted', label: 'Submitted' },
    'Needs Revision': { cls: 'status-needs-revision', label: 'Needs Revision' },
    'Approved': { cls: 'status-approved', label: 'Approved' },
    'Pending': { cls: 'status-pending', label: 'Pending' },
    'Completed': { cls: 'status-approved', label: 'Completed' },
    'Archived': { cls: 'status-pending', label: 'Archived' }
  };

  function splitList(value) {
    if (Array.isArray(value)) {
      return value.map((item) => String(item || '').trim()).filter(Boolean);
    }

    return String(value || '')
      .split(',')
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  function normalizePriorityLabel(value) {
    const raw = String(value || '').trim();
    const lower = raw.toLowerCase();
    if (lower === 'low') return 'Low';
    if (lower === 'medium') return 'Medium';
    if (lower === 'high') return 'High';
    return raw;
  }

  function priorityRank(value) {
    const label = normalizePriorityLabel(value);
    if (label === 'High') return 0;
    if (label === 'Medium') return 1;
    if (label === 'Low') return 2;
    return 3;
  }

  function canonicalStatusLabel(value) {
    const raw = String(value || '').trim();
    const lower = raw.toLowerCase();
    if (!raw) return 'Not Started';
    if (lower === 'not started') return 'Not Started';
    if (lower === 'in progress') return 'In Progress';
    if (lower === 'submitted') return 'Submitted';
    if (lower === 'for review') return 'Submitted';
    if (lower === 'needs revision') return 'Needs Revision';
    if (lower === 'approved') return 'Approved';
    if (lower === 'pending') return 'Pending';
    if (lower === 'completed') return 'Completed';
    if (lower === 'archived') return 'Archived';
    return raw;
  }

  function statusGroup(value) {
    const label = canonicalStatusLabel(value).toLowerCase();
    if (label === 'approved' || label === 'completed') return 'approved';
    if (label === 'submitted') return 'submitted';
    if (label === 'needs revision') return 'needs revision';
    if (label === 'in progress') return 'in progress';
    if (label === 'pending' || label === 'not started') return 'not started';
    return label;
  }

  function statusMatchesFilter(status, filter) {
    if (filter === 'all') return true;
    return statusGroup(status) === statusGroup(filter);
  }

  function getStatusMeta(status) {
    return STATUS_META[canonicalStatusLabel(status)] || STATUS_META['Not Started'];
  }

  function formatDate(val) {
    const s = String(val || '').trim();
    if (!s) return '';

    let d;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) d = new Date(s + 'T00:00:00');
    else d = new Date(s);

    if (isNaN(d)) return s;

    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }

  function statusToProgress(value) {
    const label = canonicalStatusLabel(value).toLowerCase();
    if (label === 'completed' || label === 'approved') return 100;
    if (label === 'submitted') return 80;
    if (label === 'needs revision') return 65;
    if (label === 'in progress') return 45;
    if (label === 'archived') return 100;
    return 0;
  }

  function isDeadlinePast(val) {
    const s = String(val || '').trim();
    if (!s) return false;
    const d = new Date(s + 'T00:00:00');
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return d < now;
  }

  function isDeadlineNear(val) {
    const s = String(val || '').trim();
    if (!s) return false;
    const d = new Date(s + 'T00:00:00');
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const diff = (d - now) / 86400000;
    return diff >= 0 && diff <= 7;
  }

  function teamLabel(project) {
    const count = splitList(project?.members).length;
    if (!count) return '—';
    return `${count} ${count === 1 ? 'member' : 'members'}`;
  }

  function normalizeProject(project) {
    const priority = normalizePriorityLabel(project?.priority_level || project?.priority || 'Low');
    const status = canonicalStatusLabel(project?.status || 'Not Started');

    return {
      id: String(project?.id || project?.proj_id || '').trim(),
      proj_id: String(project?.proj_id || project?.id || '').trim(),
      title: String(project?.title || project?.proj_name || '').trim(),
      description: String(project?.description || '').trim(),
      priority_level: priority,
      priority,
      status,
      members: splitList(project?.members),
      supervisors: splitList(project?.supervisors || project?.supervisor),
      timeline_start: String(project?.timeline_start || project?.start_date || '').trim(),
      timeline_end: String(project?.timeline_end || project?.end_date || project?.deadline || '').trim(),
      deadline: String(project?.deadline || project?.timeline_end || project?.end_date || '').trim(),
      created_at: String(project?.created_at || '').trim(),
      created_by: String(project?.created_by || '').trim(),
      archived: canonicalStatusLabel(project?.status || '').toLowerCase() === 'archived',
      owner_name: String(
        project?.owner_name ||
        project?.created_by_name ||
        project?.creator_name ||
        project?.created_by ||
        ''
      ).trim()
      ,folders: null,
      milestones: null,
      progress_logs: [],
      progress_percent: 0
    };
  }

  function sortProjects(a, b) {
    const pa = priorityRank(a.priority_level);
    const pb = priorityRank(b.priority_level);
    if (pa !== pb) return pa - pb;

    const da = String(a.deadline || a.timeline_end || '');
    const db = String(b.deadline || b.timeline_end || '');
    if (da !== db) return da.localeCompare(db);

    return String(a.title || '').localeCompare(String(b.title || ''));
  }

  async function loadProjects() {
    isLoading = true;
    loadError = '';

    try {
      const supervisorId = String(currentUser?.user_id || getCurrentUser()?.user_id || '').trim();
      if (!supervisorId) {
        allProjects = [];
        return;
      }

      const result = await callApiAction('list_proj_supervisor', {
        supervisor_user_id: supervisorId
      });

      allProjects = (result?.projects || []).map(normalizeProject).sort(sortProjects);
      // restore last-viewed collapsed project if present
      try {
        const saved = localStorage.getItem('projects.viewingProjectId');
        if (saved) {
          const found = allProjects.find(x => x.id === saved);
          if (found) {
            viewingProjectId = saved;
            viewingProjectTab = 'Details';
            if (!found.folders || found.folders === null) loadProjectFolders(saved);
            if (!found.milestones || found.milestones === null) loadProjectMilestones(saved);
          }

          // fetch bootstrap users to resolve member/supervisor IDs to names
          try {
            const boot = await callApiAction('get_proj_users_bootstrap', { user_id: supervisorId });
            if (boot?.ok) {
              const list = Array.isArray(boot.users) ? boot.users : [...(boot.interns || []), ...(boot.supervisors || [])];
              users = list;
              userMap = buildUserMap(list);
            }
          } catch (e) {
            console.warn('loadProjects: failed to load bootstrap users', e);
          }
          }
      } catch (e) {
        // ignore storage errors
      }
    } catch (error) {
      allProjects = [];
      loadError = error?.message || 'Unable to load supervisor projects.';
    } finally {
      isLoading = false;
    }
  }

  onMount(() => {
    currentUser = getCurrentUser() || currentUser;
    unsubscribeAuth = subscribeToCurrentUser((u) => {
      currentUser = u;
      loadProjects();
    });
  });

  onDestroy(() => {
    if (typeof unsubscribeAuth === 'function') unsubscribeAuth();
    if (flashTimer) clearTimeout(flashTimer);
  });

  function setFlashMessage(message) {
    actionError = '';
    actionMessage = String(message || '').trim();
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      actionMessage = '';
    }, 2200);
  }

  function setFlashError(message) {
    actionMessage = '';
    actionError = String(message || '').trim();
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      actionError = '';
    }, 3000);
  }

  function openProject(project) {
    if (!project) return;
    activeView = 'Projects';
    filterStatus = 'all';
    filterPriority = 'all';
    filterIntern = 'all';
    searchQuery = String(project.title || '').trim();
  }

  function viewProject(project) {
    if (!project) return;
    if (viewingProjectId === project.id) {
      viewingProjectId = null;
      try { localStorage.removeItem('projects.viewingProjectId'); } catch (e) {}
    } else {
      viewingProjectId = project.id;
      viewingProjectTab = 'Details';
      try { localStorage.setItem('projects.viewingProjectId', String(project.id)); } catch (e) {}
      if (!project.folders || project.folders === null) loadProjectFolders(project.id);
      if (!project.milestones || project.milestones === null) loadProjectMilestones(project.id);
    }
    activeView = 'Projects';
    filterStatus = 'all';
    filterPriority = 'all';
    filterIntern = 'all';
  }

  async function loadProjectFolders(projectId) {
    const projId = String(allProjects.find(p => p.id === projectId)?.proj_id || projectId);
    try {
      const res = await callApiAction('list_proj_submissions', { proj_id: projId });
      if (res?.ok) {
        const folders = (res.folders || []).map(f => ({
          id: f.folder_id,
          folder_id: f.folder_id,
          name: f.folder_name,
          gdrive_link: f.gdrive_link,
          created_by: f.created_by,
          submissions: (f.submissions || []).map(s => ({
            id: s.submission_id,
            submission_id: s.submission_id,
            kind: s.kind === 'link' ? 'link' : 'file',
            name: s.file_name || s.link_label || '',
            url: s.link_url || '',
            drive_url: s.link_url || '',
            gdrive: s.gdrive || ''
          }))
        }));
        allProjects = allProjects.map(p => p.id === projectId ? { ...p, folders } : p);
      } else {
        allProjects = allProjects.map(p => p.id === projectId ? { ...p, folders: [] } : p);
      }
    } catch (e) {
      console.error('loadProjectFolders error', e);
      allProjects = allProjects.map(p => p.id === projectId ? { ...p, folders: [] } : p);
    }
  }

  async function loadProjectMilestones(projectId) {
    const projId = String(allProjects.find(p => p.id === projectId)?.proj_id || projectId);
    try {
      const res = await callApiAction('list_milestones', { proj_id: projId });
      if (res?.ok) {
        const list = (res.milestones || []).map(m => ({ id: m.milestone_id, milestone: m.milestone, date: m.date, status: m.status || 'Not Started', done: Boolean(m.done), created_at: m.created_at, created_by: m.created_by, linked_files: m.linked_files || '' }));
        allProjects = allProjects.map(p => p.id === projectId ? { ...p, milestones: list } : p);
      } else {
        allProjects = allProjects.map(p => p.id === projectId ? { ...p, milestones: [] } : p);
      }
    } catch (e) {
      console.error('loadProjectMilestones error', e);
      allProjects = allProjects.map(p => p.id === projectId ? { ...p, milestones: [] } : p);
    }
  }

  async function loadFeedback(projectId) {
    feedbackLoading = { ...feedbackLoading, [projectId]: true };
    try {
      const res = await callApiAction('list_feedback', { proj_id: String(projectId) });
      if (res?.ok) feedbackMap = { ...feedbackMap, [projectId]: res.feedback || [] };
      else feedbackMap = { ...feedbackMap, [projectId]: [] };
    } catch (e) {
      feedbackMap = { ...feedbackMap, [projectId]: [] };
    } finally {
      feedbackLoading = { ...feedbackLoading, [projectId]: false };
    }
  }

  async function archiveProject(project) {
    if (!project || project.archived) return;

    const supervisorId = String(currentUser?.user_id || getCurrentUser()?.user_id || '').trim();
    if (!supervisorId) {
      setFlashError('No supervisor account found.');
      return;
    }

    try {
      const result = await callApiAction('update_proj_intern', {
        proj_id: project.proj_id || project.id,
        user_id: supervisorId,
        status: 'Archived'
      });

      if (!result?.ok) {
        setFlashError(result?.error || 'Archive failed.');
        return;
      }

      allProjects = allProjects.map((item) => (
        item.id === project.id
          ? { ...item, archived: true, status: 'Archived' }
          : item
      ));
      if (String(searchQuery || '').trim().toLowerCase() === String(project.title || '').trim().toLowerCase()) {
        searchQuery = '';
      }
      setFlashMessage('Project archived.');
    } catch (error) {
      setFlashError(error?.message || 'Archive failed.');
    }
  }

  async function restoreProject(project) {
    if (!project) return;

    const supervisorId = String(currentUser?.user_id || getCurrentUser()?.user_id || '').trim();
    if (!supervisorId) {
      setFlashError('No supervisor account found.');
      return;
    }

    try {
      const result = await callApiAction('restore_proj_intern', {
        proj_id: project.proj_id || project.id,
        user_id: supervisorId
      });

      if (!result?.ok) {
        setFlashError(result?.error || 'Restore failed.');
        return;
      }

      allProjects = allProjects.map((item) => (
        item.id === project.id
          ? { ...item, archived: false, status: result.status || 'Not Started' }
          : item
      ));
      if (String(searchQuery || '').trim().toLowerCase() === String(project.title || '').trim().toLowerCase()) {
        searchQuery = '';
      }
      activeView = 'Projects';
      setFlashMessage('Project restored.');
    } catch (error) {
      setFlashError(error?.message || 'Restore failed.');
    }
  }

  $: {
    const fallbackUser = getCurrentUser();
    supervisorLabel = String(
      currentUser?.full_name ||
      currentUser?.email ||
      fallbackUser?.full_name ||
      fallbackUser?.email ||
      'your supervisor account'
    ).trim() || 'your supervisor account';
  }

  $: activeProjects = allProjects.filter((p) => !p.archived);
  $: archivedProjects = allProjects.filter((p) => p.archived);

  $: uniqueInterns = [...new Set(activeProjects.map((p) => p.owner_name).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  $: filteredProjects = activeProjects.filter((p) => {
    const matchPriority = filterPriority === 'all' || normalizePriorityLabel(p.priority_level) === filterPriority;
    const matchStatus = statusMatchesFilter(p.status, filterStatus);
    const matchIntern = filterIntern === 'all' || p.owner_name === filterIntern;

    if (!matchPriority || !matchStatus || !matchIntern) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        String(p.title || '').toLowerCase().includes(q) ||
        String(p.description || '').toLowerCase().includes(q) ||
        String(p.owner_name || '').toLowerCase().includes(q)
      );
    }

    return true;
  });

  $: totalProjects = activeProjects.length;
  $: inProgressCount = activeProjects.filter((p) => statusGroup(p.status) === 'in progress').length;
  $: submittedCount = activeProjects.filter((p) => statusGroup(p.status) === 'submitted').length;
  $: internCount = uniqueInterns.length;
  $: archivedCount = archivedProjects.length;
  $: overviewStatusRows = STATUS_OPTIONS.map((status) => ({
    status,
    count: activeProjects.filter((p) => statusMatchesFilter(p.status, status)).length,
    meta: getStatusMeta(status)
  }));
  $: upcomingDeadlines = activeProjects
    .filter((p) => String(p.timeline_end || p.deadline || '').trim())
    .sort((a, b) => String(a.timeline_end || a.deadline || '').localeCompare(String(b.timeline_end || b.deadline || '')))
    .slice(0, 5);
  $: overviewSnippets = activeProjects.slice(0, 6);
</script>

<section class="projects-page">
  <div class="stat-cards">
    <div class="stat-card blue">
      <div class="stat-card-top">
        <div style="flex:1"></div>
        <div class="stat-icon blue"><FolderOpen size={16} /></div>
      </div>
      <div class="stat-value">{totalProjects}</div>
      <div class="stat-label">Total Projects</div>
    </div>
    <div class="stat-card amber">
      <div class="stat-card-top">
        <div style="flex:1"></div>
        <div class="stat-icon amber"><Clock3 size={16} /></div>
      </div>
      <div class="stat-value">{inProgressCount}</div>
      <div class="stat-label">In Progress</div>
    </div>
    <div class="stat-card green">
      <div class="stat-card-top">
        <div style="flex:1"></div>
        <div class="stat-icon green"><Tag size={16} /></div>
      </div>
      <div class="stat-value">{submittedCount}</div>
      <div class="stat-label">Submitted</div>
    </div>
    <div class="stat-card violet">
      <div class="stat-card-top">
        <div style="flex:1"></div>
        <div class="stat-icon violet"><Users2 size={16} /></div>
      </div>
      <div class="stat-value">{internCount}</div>
      <div class="stat-label">Interns</div>
    </div>
  </div>

  <section class="quick-panel">
    <div class="quick-head">
      <div class="view-controls">
        <button class="btn btn-ghost" class:active={activeView === 'Overview'} on:click={() => activeView = 'Overview'}>
          <Grid size={14} />
          <span>Overview</span>
        </button>
        <button class="btn btn-ghost" class:active={activeView === 'Projects'} on:click={() => activeView = 'Projects'}>
          <FolderOpen size={14} />
          <span>Projects</span>
        </button>
        <button class="btn btn-ghost" class:active={activeView === 'Archive'} on:click={() => activeView = 'Archive'}>
          <Archive size={14} />
          <span>Archive</span>
        </button>
      </div>

      <div class="quick-actions">
        <label class="search-wrap">
          <input class="search-input" type="text" placeholder="Search" bind:value={searchQuery} />
        </label>

        <select class="quick-status" bind:value={filterStatus} aria-label="Filter by status">
          <option value="all">All Status</option>
          {#each STATUS_OPTIONS as s}
            <option value={s}>{s}</option>
          {/each}
        </select>

        <select class="quick-priority" bind:value={filterPriority} aria-label="Filter by priority">
          <option value="all">All Priority</option>
          {#each PRIORITY_OPTIONS as p}
            <option value={p}>{p}</option>
          {/each}
        </select>

        {#if uniqueInterns.length > 0}
          <select class="quick-intern" bind:value={filterIntern} aria-label="Filter by intern">
            <option value="all">All Interns</option>
            {#each uniqueInterns as name}
              <option value={name}>{name}</option>
            {/each}
          </select>
        {/if}
      </div>
    </div>
  </section>

  {#if actionError}
    <div class="alert-error">{actionError}</div>
  {/if}
  {#if actionMessage}
    <div class="alert-success">{actionMessage}</div>
  {/if}

  {#if loadError}
    <div class="empty-state error-state">
      <FolderOpen size={28} />
      <div class="empty-title">Unable to load projects</div>
      <div class="empty-sub">{loadError}</div>
      <button class="retry-btn" on:click={loadProjects}>Retry</button>
    </div>
  {:else if isLoading}
    <div class="empty-state">
      <Loader2 size={22} class="spin" />
      <span>Loading projects...</span>
    </div>
  {:else if activeView === 'Overview'}
    {#if activeProjects.length === 0}
      <div class="empty-state">
        <FolderOpen size={32} />
        <div class="empty-title">No tagged projects yet</div>
        <div class="empty-sub">
          Projects tagged to your supervisor account will appear here once interns add them.
        </div>
      </div>
    {:else}
      <div class="ov-top-grid">
        <section class="card ov-card">
          <div class="ov-card-title">Project Breakdown</div>
          {#if overviewStatusRows.length === 0}
            <div class="ov-empty">No project data yet.</div>
          {:else}
            <div class="ov-status-bars">
              {#each overviewStatusRows as row}
                {@const pct = totalProjects > 0 ? Math.round((row.count / totalProjects) * 100) : 0}
                <div class="ov-bar-row">
                  <span class="ov-bar-label">{row.status}</span>
                  <div class="ov-bar-track">
                    <div class="progress-bar-inner" style="width:{pct}%"></div>
                  </div>
                  <span class="ov-bar-count"><span class="ov-ms-done">{row.count}</span>/{totalProjects}</span>
                </div>
              {/each}
            </div>
          {/if}
          {#if archivedCount > 0}
            <div class="ov-archived-note">
              <Archive size={11} /> {archivedCount} archived project{archivedCount === 1 ? '' : 's'}
            </div>
          {/if}
        </section>

        <section class="card ov-card">
          <div class="ov-card-title">Upcoming Deadlines</div>
          {#if upcomingDeadlines.length === 0}
            <div class="ov-empty">No upcoming deadlines.</div>
          {:else}
            <div class="ov-deadline-list">
              {#each upcomingDeadlines as p}
                {@const past = isDeadlinePast(p.timeline_end || p.deadline)}
                {@const near = !past && isDeadlineNear(p.timeline_end || p.deadline)}
                {@const sm = getStatusMeta(p.status)}
                <div class="ov-deadline-row">
                  <div class="ov-deadline-dot" class:ov-dot-past={past} class:ov-dot-near={near && !past}></div>
                  <div class="ov-deadline-info">
                    <div class="ov-deadline-name">{p.title}</div>
                    <div class="ov-deadline-date" class:ov-date-past={past} class:ov-date-near={near && !past}>
                      <CalendarDays size={11} /> {formatDate(p.timeline_end || p.deadline)}
                    </div>
                  </div>
                  <span class={"status-badge " + sm.cls}>{sm.label}</span>
                </div>
              {/each}
            </div>
          {/if}
        </section>
      </div>

      <section class="card ov-card">
        <div class="ov-card-head">
          <div class="ov-card-title">Assigned Projects</div>
          <button class="ov-view-all-btn" on:click={() => activeView = 'Projects'}>View all -&gt;</button>
        </div>
        {#if overviewSnippets.length === 0}
          <div class="ov-empty">No active projects.</div>
        {:else}
          <div class="ov-snippets-grid">
            {#each overviewSnippets as p (p.id)}
              {@const sm = getStatusMeta(p.status)}
              {@const pl = normalizePriorityLabel(p.priority_level)}
              {@const pct = statusToProgress(p.status)}
              {@const past = isDeadlinePast(p.timeline_end || p.deadline)}
              <div class="ov-snippet-card">
                <div class="ov-snippet-top">
                  <div class="ov-snippet-name">{p.title}</div>
                  <div class="ov-snippet-top-right">
                    <span class={"status-badge " + sm.cls}>{sm.label}</span>
                    <span class={"priority-badge priority-" + pl.toLowerCase()}>{pl}</span>
                  </div>
                </div>
                <div class="ov-snippet-progress">
                  <div class="progress-bar-outer">
                    <div class="progress-bar-inner" style="width:{pct}%"></div>
                  </div>
                  <span class="ov-snippet-pct">{pct}%</span>
                </div>
                {#if p.timeline_end || p.deadline}
                  <div class="ov-snippet-due" class:ov-date-past={past}>
                    <CalendarDays size={11} /> Due: {formatDate(p.timeline_end || p.deadline)}
                  </div>
                {/if}
                <div class="ov-snippet-actions">
                  <button class="sub-action-btn" on:click={() => viewProject(p)}>
                    <Eye size={12} /> Open
                  </button>
                  <button class="sub-action-btn" title="Archive project" on:click={() => archiveProject(p)}>
                    <Archive size={12} /> Archive
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </section>
    {/if}
  {:else if activeView === 'Archive'}
    {#if archivedProjects.length === 0}
      <div class="empty-state">
        <Archive size={28} />
        <div class="empty-title">No archived projects</div>
        <div class="empty-sub">Archived projects will appear here.</div>
      </div>
    {:else}
      <section class="proj-table-panel archive-view">
        <header class="proj-table-header">
          <span class="proj-col-name">Archive</span>
          <span class="proj-col-actions">Actions</span>
        </header>
        <div class="proj-table-body">
          {#each archivedProjects as p (p.id)}
            <div class="proj-table-row proj-arc-row">
              <span class="proj-col-name proj-name-cell">
                <div class="proj-arc-title">{p.title}</div>
                {#if p.timeline_end || p.deadline}
                  <div class="proj-arc-meta">
                    <CalendarDays size={14} />
                    <span class="proj-arc-date">{formatDate(p.timeline_end || p.deadline)}</span>
                  </div>
                {/if}
              </span>
              <div class="proj-arc-corner">
                <button class="icon-btn restore" title="Restore project" aria-label="Restore project" on:click={() => restoreProject(p)}>
                  <RotateCcw size={16} />
                </button>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}
  {:else if activeView === 'Projects'}
    {#if activeProjects.length === 0}
      <div class="empty-state">
        <FolderOpen size={32} />
        <div class="empty-title">No tagged projects yet</div>
        <div class="empty-sub">
          Projects tagged to your supervisor account will appear here once interns add them.
        </div>
      </div>
    {:else if filteredProjects.length === 0}
      <div class="empty-state">
        <FolderOpen size={22} />
        <div class="empty-title">No projects match the selected filters.</div>
        <div class="empty-sub">Try a different search, priority, or status.</div>
      </div>
    {:else}
    <div class="table-wrap">
      <table class="projects-table">
        <thead>
          <tr>
            <th>Project Title</th>
            <th>Description</th>
            <th>DueDate</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Team</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each filteredProjects as p (p.id)}
            {@const pc = PRIORITY_COLORS[normalizePriorityLabel(p.priority_level)] || DEFAULT_PRIORITY_COLOR}
            {@const sm = getStatusMeta(p.status)}
            {@const past = isDeadlinePast(p.deadline)}
            {@const near = !past && isDeadlineNear(p.deadline)}
            <tr class:proj-row-active={viewingProjectId === p.id}>
              <td class="col-title">{p.title}</td>
              <td class="col-desc">{p.description || '—'}</td>
              <td>
                <span
                  class="deadline-cell"
                  class:deadline-past={past}
                  class:deadline-near={near}
                >
                  <CalendarDays size={11} />
                  {formatDate(p.deadline)}
                  {#if past}
                    <span class="deadline-tag">Overdue</span>
                  {:else if near}
                    <span class="deadline-tag near">Soon</span>
                  {/if}
                </span>
              </td>
              <td>
                <span
                  class="priority-badge"
                  style="background:{pc.bg};color:{pc.text};border-color:{pc.border}"
                >
                  {normalizePriorityLabel(p.priority_level)}
                </span>
              </td>
              <td><span class={"status-badge " + sm.cls}>{sm.label}</span></td>
              <td class="col-team">{teamLabel(p)}</td>
              <td class="col-actions">
                <button class="icon-btn" title="Open project" aria-label="Open project" on:click={() => viewProject(p)}>
                  <Eye size={16} />
                </button>
                <button class="icon-btn archive" title="Archive project" aria-label="Archive project" on:click={() => archiveProject(p)}>
                  <Archive size={16} />
                </button>
              </td>
            </tr>
            {#if viewingProjectId === p.id}
              <tr class="proj-details-row">
                <td colspan="7">
                  <div class="proj-detail-card">
                    <div class="proj-detail-tabs">
                      <button class="proj-detail-tab-btn" class:active={viewingProjectTab === 'Details'} on:click={() => viewingProjectTab = 'Details'}>Details</button>
                      <button class="proj-detail-tab-btn" class:active={viewingProjectTab === 'Submissions'} on:click={() => { viewingProjectTab = 'Submissions'; if (!p.folders) loadProjectFolders(p.id); }}>Submissions</button>
                      <button class="proj-detail-tab-btn" class:active={viewingProjectTab === 'Milestones'} on:click={() => { viewingProjectTab = 'Milestones'; if (!p.milestones || p.milestones === null) loadProjectMilestones(p.id); }}>Milestones</button>
                      <button class="proj-detail-tab-btn" class:active={viewingProjectTab === 'Feedback'} on:click={() => { viewingProjectTab = 'Feedback'; if (!feedbackMap[p.id]) loadFeedback(p.id); }}>Feedback</button>
                    </div>
                    <div class="proj-detail-body">
                      {#if viewingProjectTab === 'Details'}
                        <div class="proj-detail-read">
                          <div class="pdr-group">
                            <div class="pdr-label">Project Title</div>
                            <div class="pdr-box title">{p.title || '—'}</div>
                          </div>

                          <div class="detail-row-full">
                            <div class="detail-label">Description</div>
                            <div class="pdr-box pdr-box-desc" class:collapsed={p.description && p.description.length > 220 && expandedDescriptionId !== p.id}>
                              {p.description || '—'}
                            </div>
                            {#if p.description && p.description.length > 220}
                              <div style="margin-top:6px">
                                <button class="btn-link" on:click={() => toggleDescription(p.id)}>{expandedDescriptionId === p.id ? 'Show less' : 'Show more'}</button>
                              </div>
                            {/if}
                          </div>

                          <div class="pdr-row-2">
                            <div class="pdr-group">
                              <div class="pdr-label">Members</div>
                              <div class="pdr-box">{(p.members && p.members.length) ? p.members.map(m => (userMap[String(m).trim()] || m)).join(', ') : '—'}</div>
                            </div>
                            <div class="pdr-group">
                              <div class="pdr-label">Supervisor</div>
                              <div class="pdr-box">{(p.supervisors && p.supervisors.length) ? p.supervisors.map(s => (userMap[String(s).trim()] || s)).join(', ') : '—'}</div>
                            </div>
                          </div>

                          <div class="pdr-row-2">
                            <div class="pdr-group">
                              <div class="pdr-label">Priority Level</div>
                              <div class="pdr-box">{normalizePriorityLabel(p.priority_level)}</div>
                            </div>
                            <div class="pdr-group">
                              <div class="pdr-label">Status</div>
                              <div class="pdr-box">{(STATUS_META[p.status] || {}).label || p.status || '—'}</div>
                            </div>
                          </div>

                          <div class="pdr-row-2">
                            <div class="pdr-group">
                              <div class="pdr-label">Timeline (Start)</div>
                              <div class="pdr-box">{p.timeline_start ? formatDate(p.timeline_start) : '—'}</div>
                            </div>
                            <div class="pdr-group">
                              <div class="pdr-label">Timeline (End)</div>
                              <div class="pdr-box">{p.timeline_end ? formatDate(p.timeline_end) : '—'}</div>
                            </div>
                          </div>

                          <div>
                            <div class="progress-bar-outer" style="margin-top:8px">
                              <div class="progress-bar-inner" style="width:{statusToProgress(p.status)}%"></div>
                            </div>
                          </div>
                        </div>
                      {:else if viewingProjectTab === 'Submissions'}
                        {#if isLoadingFolders}
                          <div class="proj-detail-empty" style="padding:1rem 1.25rem">
                            <Loader2 size={18} class="spin" /> Loading folders…
                          </div>
                        {:else if !p.folders || p.folders.length === 0}
                          <div class="proj-detail-empty" style="padding:1rem 1.25rem">No folders yet.</div>
                        {:else}
                          <div class="folder-list">
                            {#each p.folders as folder (folder.id)}
                              <div class="folder-block">
                                <div class="folder-header" role="button" tabindex="0" on:click={() => { if (renamingFolderId !== folder.id) toggleFolder(folder.id); }} on:keydown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && renamingFolderId !== folder.id) toggleFolder(folder.id); }}>
                                  <span class="folder-chevron">{expandedFolderIds.has(folder.id) ? '▾' : '▸'}</span>
                                  <span class="folder-icon">📁</span>
                                  {#if renamingFolderId === folder.id}
                                    <input
                                      class="folder-rename-input"
                                      bind:value={renamingFolderName}
                                      on:click|stopPropagation
                                      on:keydown={(e) => { if (e.key === 'Enter') confirmRename(p.id); if (e.key === 'Escape') { renamingFolderId = null; } }}
                                    />
                                    <button class="folder-rename-confirm" on:click|stopPropagation={() => confirmRename(p.id)}>✓</button>
                                  {:else}
                                    <span class="folder-name">{folder.name}</span>
                                    <button class="folder-action-btn" title="Rename" on:click|stopPropagation={() => startRenaming(folder.id, folder.name)}><Pencil size={12} /></button>
                                    <button class="folder-action-btn folder-delete-btn" title="Delete folder" on:click|stopPropagation={() => deleteFolder(p.id, folder.id)}><Trash2 size={12} /></button>
                                  {/if}
                                </div>

                                {#if expandedFolderIds.has(folder.id)}
                                  <div class="folder-content">
                                        {#if pendingUpload.projectId === p.id && pendingUpload.folderId === folder.id && pendingUpload.file}
                                      <div class="submission-card pending-upload" style="margin:0.5rem 0.75rem;">
                                        <div class="submission-card-left">
                                          <div class="sub-file-icon">📄</div>
                                          <div class="submission-meta">
                                            <input class="sub-input" bind:value={pendingUpload.name} placeholder="File name" />
                                            <select class="sub-input" bind:value={pendingUpload.type}>
                                              {#each FILE_TYPE_OPTIONS as t}<option value={t}>{t}</option>{/each}
                                            </select>
                                            <div class="submission-info">Selected: {pendingUpload.file ? pendingUpload.file.name : ''} ({pendingUpload.file ? (pendingUpload.file.size / (1024*1024)).toFixed(2) + ' MB' : ''})</div>
                                          </div>
                                        </div>
                                        <div class="submission-actions">
                                          <button class="sub-action-btn" disabled={isUploadingFile} on:click={() => confirmUpload(p.id, folder.id)}>
                                            {#if isUploadingFile}<Loader2 size={13} class="spin" /> Uploading…{:else}Upload{/if}
                                          </button>
                                          <button class="sub-cancel-btn" disabled={isUploadingFile} on:click={cancelPendingUpload}>Cancel</button>
                                        </div>
                                      </div>
                                    {/if}

                                    {#if folder.submissions && folder.submissions.length > 0}
                                      <div class="submissions-list" style="padding:0 0.75rem 0.75rem;">
                                        {#each folder.submissions as s}
                                          {#if s.kind === 'file'}
                                            <div class="submission-card">
                                              <div class="submission-card-left">
                                                <div class="sub-file-icon">📄</div>
                                                <div class="submission-meta">
                                                  <div class="submission-name">{s.name}</div>
                                                  <div class="submission-info">Uploaded: {s.uploaded_at ? formatDate(s.uploaded_at) : ''}</div>
                                                </div>
                                              </div>
                                              <div class="submission-actions">
                                                <button class="icon-btn" title="View in Drive" on:click={() => viewSubmission(s)}><Eye size={14} /></button>
                                                <button class="icon-btn" title="Open in Drive" on:click={() => downloadSubmission(s)}><Download size={14} /></button>
                                              </div>
                                            </div>
                                          {:else}
                                            <div class="submission-card link-card">
                                              <div class="link-card-body">
                                                <div class="link-card-title">🔗 {s.title}</div>
                                                <div class="link-card-url">{s.url}</div>
                                                <div class="submission-info">Added: {s.added_at ? formatDate(s.added_at) : ''}</div>
                                              </div>
                                              <div class="submission-actions">
                                                <button class="sub-open-btn" on:click={() => viewSubmission(s)}>Open Link</button>
                                              </div>
                                            </div>
                                          {/if}
                                        {/each}
                                      </div>
                                    {:else}
                                      <div class="proj-detail-empty" style="padding:0.5rem 0.75rem 0.75rem">No files or links in this folder yet.</div>
                                    {/if}
                                  </div>
                                {/if}
                              </div>
                            {/each}
                          </div>
                        {/if}
                      {:else if viewingProjectTab === 'Milestones'}
                        {#if p.milestones && p.milestones.length > 0}
                          <div class="milestone-list">
                            {#each p.milestones as m}
                              <div class="ms-card" class:ms-expanded={expandedMilestoneIds.has(m.id)}>
                                <div class="ms-header" on:click={() => toggleMilestoneExpand(m.id)} role="button" tabindex="0" on:keydown={(e)=>{ if(e.key==='Enter'||e.key===' ') toggleMilestoneExpand(m.id); }}>
                                  <span class={"ms-icon " + (STATUS_META[m.status]?.cls || STATUS_META['Not Started'].cls)}></span>
                                  <span class="ms-title">{m.milestone}</span>
                                  {#if m.date}<span class="ms-due">Due: {formatDate(m.date)}</span>{/if}
                                  <span class="ms-chevron">{expandedMilestoneIds.has(m.id) ? '▲' : '▼'}</span>
                                </div>

                                {#if expandedMilestoneIds.has(m.id)}
                                  <div class="ms-body">
                                    {#if parseMilestoneFiles(m).length > 0}
                                      <div class="ms-linked-section">
                                        <div class="ms-linked-label">Linked Files:</div>
                                        <ul class="ms-linked-list">
                                          {#each parseMilestoneFiles(m) as lf}
                                            <li class="ms-linked-item">
                                              <span>📄 {lf.name}</span>
                                              {#if lf.drive_url}<a href={lf.drive_url} target="_blank" rel="noopener" class="ms-open-link">Open</a>{/if}
                                            </li>
                                          {/each}
                                        </ul>
                                      </div>
                                    {:else}
                                      <div class="ms-no-links">No linked files yet.</div>
                                    {/if}
                                  </div>
                                {/if}
                              </div>
                            {/each}
                          </div>
                        {:else}
                          <div class="proj-detail-empty">No milestones yet.</div>
                        {/if}

                      {:else if viewingProjectTab === 'Feedback'}
                        <div class="feedback-wrap">
                          <div>
                            <textarea class="fb-reply-input" placeholder="Write a comment..." bind:value={newFeedbackText[p.id]} rows="3"></textarea>
                            <div class="fb-actions">
                              <button class="sub-action-btn" on:click={() => submitFeedback(p.id)}>Post Comment</button>
                            </div>
                          </div>

                          {#if feedbackLoading[p.id]}
                            <div class="proj-detail-empty">Loading feedback…</div>
                          {:else if !(feedbackMap[p.id] || []).length}
                            <div class="proj-detail-empty">No feedback yet.</div>
                          {:else}
                            <div style="padding-top:8px; display:flex; flex-direction:column; gap:8px;">
                              {#each (feedbackMap[p.id] || []).filter(f => !f.parent_id) as f}
                                <div class="feedback-thread">
                                  <div class="feedback-card">
                                    <div class="feedback-card-top">
                                      <div style="display:flex;gap:8px;align-items:center">
                                        <div class="fb-role-badge">{f.commenter_role || 'User'}</div>
                                        <div class="fb-meta">{f.commenter_name || f.commenter} • {humanizeTime(f.created_at)}</div>
                                      </div>
                                    </div>
                                    <div class="fb-comment-text">{f.comment_text}</div>
                                    <div class="fb-actions">
                                      <button class="fb-reply-btn" on:click={() => replyingTo = { ...replyingTo, [p.id]: replyingTo[p.id] === f.id ? null : f.id }}>{replyingTo[p.id] === f.id ? 'Cancel' : 'Reply'}</button>
                                      <button class="fb-reply-btn" on:click={() => deleteFeedback(p.id, f.feedback_id || f.id)}>Delete</button>
                                    </div>
                                    {#if replyingTo[p.id] === f.id}
                                      <div class="fb-reply-compose">
                                        <textarea class="fb-reply-input" placeholder="Write a reply..." bind:value={replyText[p.id]} rows="2"></textarea>
                                        <div style="display:flex;gap:8px;margin-top:6px">
                                          <button class="sub-action-btn" on:click={() => submitReply(p.id, f.id)}>Send Reply</button>
                                        </div>
                                      </div>
                                    {/if}
                                  </div>
                                  {#each feedbackChildren(p.id, f.id) as child}
                                    <div class="feedback-reply">
                                      <div style="display:flex;gap:8px;align-items:center">
                                        <div class="fb-role-badge">{child.commenter_role || 'User'}</div>
                                        <div class="fb-meta">{child.commenter_name || child.commenter} • {humanizeTime(child.created_at)}</div>
                                      </div>
                                      <div class="fb-comment-text">{child.comment_text}</div>
                                    </div>
                                  {/each}
                                </div>
                              {/each}
                            </div>
                          {/if}
                        </div>
                      {/if}
                    </div>
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>

    <div class="projects-cards-mobile">
      {#each filteredProjects as p (p.id)}
        {@const pc = PRIORITY_COLORS[normalizePriorityLabel(p.priority_level)] || DEFAULT_PRIORITY_COLOR}
        {@const sm = getStatusMeta(p.status)}
        {@const past = isDeadlinePast(p.deadline)}
        {@const near = !past && isDeadlineNear(p.deadline)}
        <div class="project-card">
          <div class="project-card-header">
            <div
              class="priority-badge"
              style="background:{pc.bg};color:{pc.text};border-color:{pc.border}"
            >
              <Tag size={10} /> {normalizePriorityLabel(p.priority_level)}
            </div>
            <span class={"status-badge " + sm.cls}>{sm.label}</span>
          </div>
          <div class="project-title">{p.title}</div>
          {#if p.description}
            <p class="project-desc">{p.description}</p>
          {/if}
          <div class="project-meta">
            {#if p.deadline}
              <div class="meta-item" class:deadline-past={past} class:deadline-near={near}>
                <CalendarDays size={12} /> {formatDate(p.deadline)}
                {#if past}
                  <span class="deadline-tag">Overdue</span>
                {:else if near}
                  <span class="deadline-tag near">Soon</span>
                {/if}
              </div>
            {/if}
            <div class="meta-item team-chip"><Users2 size={12} /> {teamLabel(p)}</div>
          </div>
          <div class="project-card-footer">
            <button class="sub-action-btn" on:click={() => viewProject(p)}>
              <Eye size={12} /> Open
            </button>
            <button class="sub-action-btn" on:click={() => archiveProject(p)}>
              <Archive size={12} /> Archive
            </button>
          </div>
        </div>
      {/each}
    </div>
    {/if}
  {/if}
</section>

<style>
  .projects-page { padding: 4px 0 12px; display: flex; flex-direction: column; gap: 10px; font-family: inherit; }

  .stat-cards { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 0; }
  .stat-card {
    flex: 1; min-width: 120px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 12px 14px 10px;
    display: flex; flex-direction: column; gap: 6px;
  }
  .stat-card-top { display: flex; align-items: center; margin-bottom: 4px; }
  .stat-icon {
    width: 28px; height: 28px; border-radius: 7px;
    display: grid; place-items: center;
  }
  .stat-icon.blue { background: #dbeafe; color: #2563eb; }
  .stat-icon.amber { background: #fef3c7; color: #d97706; }
  .stat-icon.green { background: #dcfce7; color: #16a34a; }
  .stat-icon.violet { background: #ede9fe; color: #7c3aed; }
  :global(body.dark) .stat-icon.blue { background: #1e3a5f; color: #60a5fa; }
  :global(body.dark) .stat-icon.amber { background: #3b2600; color: #fbbf24; }
  :global(body.dark) .stat-icon.green { background: #052e16; color: #4ade80; }
  :global(body.dark) .stat-icon.violet { background: #2e1065; color: #a78bfa; }
  .stat-value { font-size: 22px; font-weight: 700; color: var(--color-heading); line-height: 1; }
  .stat-label { font-size: 11.5px; color: var(--color-sidebar-text); }

  .quick-panel {
    background: linear-gradient(180deg, var(--color-surface) 0%, var(--color-surface) 100%);
    border: 1px solid var(--color-border);
    border-radius: 0.9rem;
    padding: 0.48rem 0.8rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-sizing: border-box;
  }
  .quick-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    gap: 0.75rem;
  }
  .view-controls { display: flex; gap: 0.35rem; flex-wrap: wrap; }
  .view-controls .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin-right: 0.4rem;
    border-radius: 0.55rem;
    padding: 0.32rem 0.6rem;
    background: transparent;
    border: 1px solid var(--color-border);
    font-size: 0.82rem;
    color: var(--color-sidebar-text);
    cursor: pointer;
  }
  .view-controls .btn.active {
    background: var(--color-soft);
    color: var(--color-heading);
    border-color: var(--color-border);
  }
  .view-controls .btn:hover { color: var(--color-text); }
  .quick-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    align-items: center;
    justify-content: flex-end;
  }
  .search-wrap {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0 0.7rem;
    color: var(--color-muted);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 0.7rem;
  }
  .quick-actions select,
  .quick-status,
  .quick-priority,
  .quick-intern {
    padding: 0.34rem 0.6rem;
    border-radius: 0.7rem;
    font-size: 0.85rem;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
  }
  .search-input {
    border: 0;
    outline: none;
    background: transparent;
    color: var(--color-text);
    font-size: 0.85rem;
    width: 9rem;
    padding: 0.34rem 0;
  }
  .quick-actions select:focus,
  .quick-status:focus,
  .quick-priority:focus,
  .quick-intern:focus,
  .search-input:focus {
    outline: none;
    border-color: #2563eb;
  }
  :global(body.dark) .quick-panel { background: #1f2937; border-color: #374151; }
  :global(body.dark) .search-wrap { background: #1f2937; border-color: #374151; }
  :global(body.dark) .quick-actions select,
  :global(body.dark) .quick-status,
  :global(body.dark) .quick-priority,
  :global(body.dark) .quick-intern {
    background: #1f2937;
    border-color: #374151;
    color: #f1f5f9;
  }
  :global(body.dark) .search-input { color: #f1f5f9; }

  .alert-success {
    padding: 10px 14px;
    border-radius: 8px;
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    color: #15803d;
    font-size: 13px;
  }
  .alert-error {
    padding: 10px 14px;
    border-radius: 8px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #dc2626;
    font-size: 13px;
  }
  :global(body.dark) .alert-success { background: #052e16; border-color: #166534; color: #4ade80; }
  :global(body.dark) .alert-error { background: #2d0a0a; border-color: #7f1d1d; color: #f87171; }

  .table-wrap {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    overflow: auto;
  }
  .projects-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
  .projects-table thead tr { background: var(--color-soft); }
  .projects-table th {
    padding: 10px 14px;
    text-align: left;
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--color-sidebar-text);
    border-bottom: 1px solid var(--color-border);
    white-space: nowrap;
  }
  .projects-table td {
    padding: 10px 14px;
    vertical-align: middle;
    border-bottom: 1px solid var(--color-border);
    color: var(--color-text);
  }
  .projects-table tbody tr:last-child td { border-bottom: none; }
  .projects-table tbody tr:hover { background: var(--color-soft); }
  .col-title { font-weight: 600; min-width: 140px; font-size: 0.88rem; }
  .col-desc { color: var(--color-sidebar-text); max-width: 220px; font-size: 0.78rem; }
  .col-team {
    white-space: nowrap;
    font-weight: 500;
    color: #2563eb;
  }
  .col-actions {
    white-space: nowrap;
    text-align: center;
  }
  .projects-table th:last-child { text-align: center; }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 8px;
    padding: 6px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    color: var(--color-accent);
    cursor: pointer;
    margin: 0 0.2rem;
    transition: transform 0.12s, background 0.12s, border-color 0.12s;
  }
  .icon-btn:hover {
    background: color-mix(in srgb, var(--color-accent) 12%, var(--color-surface));
    border-color: var(--color-accent);
    transform: translateY(-1px);
  }
  .icon-btn:disabled,
  .sub-action-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    background: var(--color-surface);
    border-color: var(--color-border);
    color: var(--color-sidebar-text);
  }
  .icon-btn.archive {
    background: transparent;
    border-color: rgba(255,255,255,0.06);
    color: var(--color-accent);
  }
  .icon-btn.restore {
    background: transparent;
    border-color: rgba(255,255,255,0.06);
    color: #10b981;
  }
  .icon-btn.restore:hover {
    background: rgba(16,185,129,0.1);
    border-color: #10b981;
  }

  .priority-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: 20px;
    font-size: 10.5px;
    font-weight: 600;
    border: 1px solid;
    white-space: nowrap;
  }
  .status-badge {
    display: inline-block;
    padding: 3px 9px;
    border-radius: 20px;
    font-size: 10.5px;
    font-weight: 600;
    white-space: nowrap;
  }
  .status-not-started { background: #f1f5f9; color: #64748b; }
  .status-in-progress { background: #fffbeb; color: #d97706; }
  .status-submitted { background: #f5f3ff; color: #7c3aed; }
  .status-needs-revision { background: #fef2f2; color: #dc2626; }
  .status-approved { background: #f0fdf4; color: #16a34a; }
  .status-pending { background: #fefce8; color: #ca8a04; }
  :global(body.dark) .status-not-started { background: #1e293b; color: #94a3b8; }
  :global(body.dark) .status-in-progress { background: #3b2600; color: #fbbf24; }
  :global(body.dark) .status-submitted { background: #2e1065; color: #c084fc; }
  :global(body.dark) .status-needs-revision { background: #2d0a0a; color: #f87171; }
  :global(body.dark) .status-approved { background: #052e16; color: #4ade80; }
  :global(body.dark) .status-pending { background: #3b2600; color: #fbbf24; }

  .deadline-cell { display: inline-flex; align-items: center; gap: 4px; font-size: 0.78rem; }
  .deadline-cell.deadline-past { color: #dc2626; }
  .deadline-cell.deadline-near { color: #d97706; }
  .deadline-tag {
    display: inline-block;
    font-size: 10px;
    font-weight: 600;
    padding: 1px 7px;
    border-radius: 20px;
    background: #fef2f2;
    color: #dc2626;
  }
  .deadline-tag.near { background: #fffbeb; color: #d97706; }
  :global(body.dark) .deadline-tag { background: #2d0a0a; color: #f87171; }
  :global(body.dark) .deadline-tag.near { background: #3b2600; color: #fbbf24; }

  .ov-top-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  @media (max-width: 680px) {
    .ov-top-grid { grid-template-columns: 1fr; }
  }

  .ov-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 0.9rem;
    padding: 1rem 1.15rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  :global(body.dark) .ov-card { background: #161c27 !important; border-color: #ffffff0f !important; }

  .ov-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.6rem 1rem;
  }
  .ov-card-title {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--color-heading);
    letter-spacing: -0.01em;
  }
  .ov-empty { font-size: 0.83rem; color: var(--color-sidebar-text); padding: 0.25rem 0.1rem; }

  .ov-status-bars { display: flex; flex-direction: column; gap: 0.55rem; }
  .ov-bar-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
  }
  .ov-bar-label {
    font-size: 0.78rem;
    color: var(--color-heading);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
    flex-shrink: 0;
  }
  .ov-bar-track { flex: 1; height: 5px; background: var(--color-border); border-radius: 999px; overflow: hidden; }
  .ov-bar-count { font-size: 0.77rem; color: var(--color-sidebar-text); white-space: nowrap; }
  .ov-ms-done { font-weight: 700; color: var(--color-heading); }
  .ov-archived-note {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.75rem;
    color: var(--color-sidebar-text);
  }

  .ov-deadline-list { display: flex; flex-direction: column; gap: 0.55rem; }
  .ov-deadline-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
  }
  .ov-deadline-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: #2563eb;
    flex-shrink: 0;
  }
  .ov-dot-past { background: #dc2626; }
  .ov-dot-near { background: #d97706; }
  .ov-deadline-info { min-width: 0; flex: 1; }
  .ov-deadline-name {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--color-heading);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ov-deadline-date {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.77rem;
    color: var(--color-sidebar-text);
  }
  .ov-date-past { color: #dc2626; }
  .ov-date-near { color: #d97706; }
  .ov-view-all-btn {
    background: transparent;
    border: 0;
    color: #2563eb;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
  }

  .ov-snippets-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 0.75rem;
  }
  .ov-snippet-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 0.8rem 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  :global(body.dark) .ov-snippet-card { background: #0d1117 !important; border-color: #ffffff0f !important; }
  .ov-snippet-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .ov-snippet-name {
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--color-heading);
    min-width: 0;
  }
  .ov-snippet-top-right { display: flex; gap: 0.35rem; flex-wrap: wrap; justify-content: flex-end; }
  .ov-snippet-progress {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }
  .progress-bar-outer { height: 10px; background: var(--color-border); border-radius: 999px; overflow: hidden; }
  .progress-bar-inner { height: 100%; background: linear-gradient(90deg, #10b981, #3b82f6); border-radius: 999px; transition: width 350ms ease; }
  .ov-snippet-progress .progress-bar-outer { flex: 1; }
  .ov-snippet-pct { font-size: 0.77rem; color: var(--color-sidebar-text); white-space: nowrap; }
  .ov-snippet-due { font-size: 0.77rem; color: var(--color-sidebar-text); display: inline-flex; align-items: center; gap: 0.3rem; }
  .ov-snippet-actions { display: flex; gap: 0.45rem; flex-wrap: wrap; }

  .proj-table-panel {
    overflow: hidden;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 0.9rem;
    margin-top: 1rem;
  }
  :global(body.dark) .proj-table-panel { background: #0d1117 !important; border-color: #ffffff0f !important; }
  .proj-table-header {
    display: grid;
    grid-template-columns: minmax(0,1fr) 6rem;
    align-items: center;
    gap: 0.9rem;
    padding: 0.85rem 1rem;
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
    color: var(--color-heading);
    font-size: 0.88rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  :global(body.dark) .proj-table-header { background: #161c27 !important; border-bottom-color: #ffffff0f !important; color: #e5edf8 !important; }
  .proj-table-body { display: grid; background: var(--color-soft); padding: 0.4rem; gap: 0.4rem; }
  :global(body.dark) .proj-table-body { background: #0d1117 !important; }
  .proj-table-row {
    display: grid;
    grid-template-columns: minmax(0,1fr) 6rem;
    align-items: center;
    gap: 0.9rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--color-border);
    border-radius: 0.65rem;
    background: var(--color-surface);
    transition: border-color 140ms ease, box-shadow 140ms ease;
  }
  .proj-table-row:hover { border-color: var(--color-accent); box-shadow: 0 8px 22px -20px rgba(15,23,42,.35); }
  :global(body.dark) .proj-table-row { background: #161c27 !important; border-color: #ffffff0f !important; }
  .proj-name-cell { font-size: 0.88rem; font-weight: 600; color: var(--color-heading); }
  .proj-arc-row { position: relative; }
  .proj-arc-corner { display: flex; justify-content: flex-end; }
  .proj-arc-title { font-size: 0.88rem; font-weight: 600; color: var(--color-heading); }
  .proj-arc-meta {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.35rem;
    color: var(--color-sidebar-text);
    font-size: 0.77rem;
  }
  .proj-arc-date { font-weight: 700; color: var(--color-heading); }

  .sub-action-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.38rem 0.85rem;
    border-radius: 0.45rem;
    font-size: 0.82rem;
    font-weight: 500;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    color: var(--color-heading);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .sub-action-btn:hover { background: var(--color-soft); border-color: var(--color-accent); }
  :global(body.dark) .sub-action-btn { background: #161c27; border-color: #ffffff10; }

  .projects-cards-mobile { display: grid; grid-template-columns: 1fr; gap: 12px; }
  .project-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .project-card-header { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .project-title { font-size: 14px; font-weight: 600; color: var(--color-heading); }
  .project-desc { font-size: 12.5px; color: var(--color-sidebar-text); margin: 0; line-height: 1.5; }
  .project-meta { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .meta-item {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--color-sidebar-text);
  }
  .meta-item.deadline-past { color: #dc2626; }
  .meta-item.deadline-near { color: #d97706; }
  .team-chip { color: #2563eb; font-weight: 500; }
  .project-card-footer {
    display: flex;
    gap: 6px;
    margin-top: 4px;
    padding-top: 10px;
    border-top: 1px solid var(--color-border);
  }
  .retry-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    background: #2563eb;
    color: #fff;
    border: none;
    cursor: pointer;
  }
  .retry-btn:hover { background: #1d4ed8; }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 48px 20px;
    color: var(--color-sidebar-text);
    text-align: center;
  }
  .empty-title { font-size: 14px; font-weight: 600; color: var(--color-text); }
  .empty-sub { font-size: 12.5px; }

  :global(.spin) { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  :global(body.dark) .table-wrap { background: #1f2937; border-color: #374151; }
  :global(body.dark) .projects-table thead tr { background: #111827; }
  :global(body.dark) .projects-table tbody tr:hover { background: #111827; }
  :global(body.dark) .project-card { background: #1f2937; border-color: #374151; }
  :global(body.dark) .proj-table-panel { background: #0d1117 !important; border-color: #ffffff0f !important; }
  :global(body.dark) .proj-table-header { background: #161c27 !important; border-bottom-color: #ffffff0f !important; color: #e5edf8 !important; }
  :global(body.dark) .proj-table-body { background: #0d1117 !important; }
  :global(body.dark) .proj-table-row { background: #161c27 !important; border-color: #ffffff0f !important; }
  :global(body.dark) .ov-card { background: #161c27 !important; border-color: #ffffff0f !important; }
  :global(body.dark) .ov-snippet-card { background: #0d1117 !important; border-color: #ffffff0f !important; }
  :global(body.dark) .icon-btn { background: #161c27; border-color: #ffffff10; }
  :global(body.dark) .retry-btn { background: #1d4ed8; }
  :global(body.dark) .priority-badge { filter: brightness(.85) saturate(.9); }

  @media (max-width: 820px) {
    .quick-head { flex-direction: column; align-items: stretch; }
    .quick-actions { justify-content: flex-start; }
    .search-wrap { width: 100%; }
    .search-input { width: 100%; }
  }

  @media (max-width: 700px) {
    .table-wrap { display: none; }
    .projects-cards-mobile { display: grid; }
  }

  @media (min-width: 701px) {
    .projects-cards-mobile { display: none; }
  }

  /* Inline detail card styles (collapsed project view) */
  .proj-row-active { border-color: var(--color-accent) !important; border-bottom-left-radius: 0 !important; border-bottom-right-radius: 0 !important; }
  .proj-detail-card {
    background: var(--color-surface);
    border: 1px solid var(--color-accent);
    border-top: none;
    border-radius: 0 0 0.65rem 0.65rem;
    overflow: hidden;
  }
  :global(body.dark) .proj-detail-card { background: #161c27 !important; border-color: #3b82f6 !important; }

  .proj-detail-tabs {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-soft);
    padding: 0 1rem;
  }
  :global(body.dark) .proj-detail-tabs { background: #0d1117 !important; border-bottom-color: #ffffff0f !important; }

  .proj-detail-tab-btn {
    padding: 0.6rem 1rem;
    font-size: 0.82rem;
    font-weight: 500;
    color: var(--color-sidebar-text);
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
    white-space: nowrap;
  }
  .proj-detail-tab-btn:hover { color: var(--color-heading); }
  .proj-detail-tab-btn.active { color: #3b82f6; border-bottom-color: #3b82f6; font-weight: 600; }

  .proj-detail-body { padding: 1rem 1.25rem; min-height: 5rem; }
  .proj-detail-empty { font-size: 0.83rem; color: var(--color-muted, var(--color-sidebar-text)); }

  .icon-btn-active { background: rgba(59,130,246,0.12) !important; color: #3b82f6 !important; }

  /* Details grid and form styles copied from ProjectsIntern for consistent typography */
  .proj-detail-grid { display:grid; grid-template-columns: 1fr; gap:0.75rem; padding:1rem 1.25rem; }
  .proj-detail-grid.small-details { font-size: 0.9rem; }
  .detail-description { white-space:pre-wrap; }
  .detail-description.collapsed { display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; line-clamp:3; overflow:hidden; }
  .btn-link { background:none; border:0; color:var(--color-link); cursor:pointer; padding:0; font-size:0.9rem }
  .detail-row-two { display:grid; grid-template-columns: 1fr 1fr; gap:1rem; margin-left:0.5rem; }
  .detail-row-full { display:block; }
  .detail-item { display:flex; flex-direction:column; gap:6px; }
  .detail-label { font-size:0.85rem; color:var(--color-sidebar-text); font-weight:600; }
  .detail-value { font-size:0.95rem; color:var(--color-heading); font-weight:600; }
  .boxed { background: var(--color-surface-muted); border:1px solid var(--color-border); border-radius:8px; padding:10px 12px; box-sizing:border-box; }
  .detail-value.title { font-size:1.05rem; }
  .detail-value.description { color:var(--color-text); font-weight:500; line-height:1.45; }
  .meta-link { color:#60a5fa; text-decoration:underline; }
  .muted { color:var(--color-sidebar-text); font-weight:500; }
  .detail-value.timeline { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* ── Inline Edit Form (Details tab) ────────────────── */
  .inline-edit-form { padding: 1rem 1.25rem; display: flex; flex-direction: column; gap: 0.75rem; }
  .ief-group { display: flex; flex-direction: column; gap: 0.3rem; }
  .ief-label { font-size: 0.8rem; font-weight: 600; color: var(--color-sidebar-text); }
  .ief-input {
    font-size: 0.88rem; font-family: inherit; color: var(--color-text);
    background: var(--color-surface-muted); border: 1px solid var(--color-border);
    border-radius: 7px; padding: 0.42rem 0.7rem; width: 100%; box-sizing: border-box;
    transition: border-color 0.15s;
  }
  .ief-input:focus { outline: none; border-color: #3b82f6; }
  .ief-textarea { resize: vertical; min-height: 72px; }
  .ief-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
  .ief-actions { display: flex; justify-content: flex-end; gap: 0.5rem; padding-top: 0.25rem; }

  /* ── Details Read View ──────────────────────────────── */
  .proj-detail-read { padding: 0.75rem 1.25rem; display: flex; flex-direction: column; gap: 0.75rem; }
  .pdr-header { display: flex; justify-content: flex-end; margin-bottom: 0; }
  .pdr-group { display: flex; flex-direction: column; gap: 0.3rem; }
  .pdr-label { font-size: 0.8rem; font-weight: 600; color: var(--color-sidebar-text); }
  .pdr-box {
    font-size: 0.88rem; font-family: inherit; color: var(--color-text);
    background: var(--color-surface-muted); border: 1px solid var(--color-border);
    border-radius: 7px; padding: 0.42rem 0.7rem; width: 100%; box-sizing: border-box;
    min-height: 2.1rem;
  }
  .pdr-box-desc { white-space: pre-wrap; line-height: 1.45; min-height: 4rem; }
  .pdr-box-desc.collapsed { display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; line-clamp:3; overflow:hidden; }
  .pdr-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
  .progress-bar-outer { height:10px; background:var(--color-border); border-radius:999px; overflow:hidden; }
  .progress-bar-inner { height:100%; background:linear-gradient(90deg,#10b981,#3b82f6); border-radius:999px; transition:width 350ms ease; }
  .pdr-footer { display:flex; justify-content:flex-end; margin-top:0.5rem; }

  .proj-priority-pill {
    display: inline-flex; align-items: center; justify-content: center;
    padding: 0.22rem 0.6rem; border-radius: 999px;
    font-size: 0.78rem; font-weight: 700; color: var(--color-text);
    background: rgba(99,102,241,0.06); border: 1px solid rgba(99,102,241,0.12);
  }

  /* priority color variants */
  .proj-priority-pill.priority-low { background: rgba(56,189,248,0.08); color: #38bdf8; border-color: rgba(56,189,248,0.12); }
  .proj-priority-pill.priority-medium { background: rgba(16,185,129,0.08); color: #10b981; border-color: rgba(16,185,129,0.12); }
  .proj-priority-pill.priority-high { background: rgba(239,68,68,0.08); color: #ef4444; border-color: rgba(239,68,68,0.12); }

  /* table alignment rules omitted to avoid unused-selector warnings */

  /* Additional submissions / folder / milestones / feedback styles (copied from ProjectsIntern) */
  .add-link-form {
    display:flex; flex-direction:column; gap:0.5rem;
    padding:0.65rem 1.25rem 0.75rem;
    background:var(--color-soft);
    border-top:1px solid var(--color-border);
    border-bottom:1px solid var(--color-border);
  }
  :global(body.dark) .add-link-form { background:#0d1117; }
  .sub-input {
    padding:0.42rem 0.7rem; border-radius:0.4rem;
    border:1px solid var(--color-border);
    background:var(--color-surface); color:var(--color-heading);
    font-size:0.87rem; outline:none;
  }
  .sub-input:focus { border-color:#3b82f6; }
  .add-link-actions { display:flex; gap:0.5rem; align-items:center; }
  .sub-cancel-btn { font-size:0.82rem; color:var(--color-sidebar-text); background:transparent; border:none; cursor:pointer; padding:0.38rem 0.5rem; }
  .sub-cancel-btn:hover { color:var(--color-heading); }
  .sub-error { font-size:0.82rem; color:#ef4444; }

  .submissions-list { display:flex; flex-direction:column; gap:0.6rem; padding:0.75rem 1.25rem 1rem; }

  .add-milestone-bar { background: var(--color-surface); border:1px solid var(--color-border); padding:0.6rem; border-radius:8px; align-items:center; }
  .add-milestone-bar .input { padding:0.45rem 0.75rem; border-radius:6px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-heading); font-size:0.87rem; font-family:inherit; }
  .add-milestone-btn { display:inline-flex; align-items:center; gap:0.5rem; padding:0.4rem 0.9rem; border-radius:8px; background:transparent; border:1px solid var(--color-border); color:var(--color-heading); font-size:0.87rem; font-family:inherit; }
  .add-milestone-btn .icon { color:#7c3aed; }

  .status-select {
    appearance: none; -webkit-appearance: none; -moz-appearance: none;
    padding:0.12rem 0.6rem; border-radius:0.45rem; border:1px solid var(--color-border);
    background: var(--color-surface); color:var(--color-heading); font-weight:700; cursor:pointer;
    font-size:0.78rem; height:28px; min-width:96px; text-align:center; box-sizing:border-box; font-family:inherit;
  }
  .status-select:focus { outline:none; border-color:#3b82f6; }

  .status-pill {
    display:inline-flex; align-items:center; justify-content:center;
    padding:0.12rem 0.6rem; border-radius:0.45rem; border:1px solid rgba(255,255,255,0.06);
    background: rgba(59,130,246,0.08); color:var(--color-heading); font-weight:700;
    font-size:0.78rem; height:28px; min-width:96px; text-align:center; box-sizing:border-box;
  }
  :global(body.dark) .status-pill { background: rgba(99,102,241,0.12); border-color: #ffffff20; color:#fff; }

  .submission-card {
    display:flex; justify-content:space-between; align-items:center;
    gap:0.75rem; padding:0.75rem 1rem;
    border:1px solid var(--color-border); border-radius:0.6rem;
    background:var(--color-surface);
  }
  :global(body.dark) .submission-card { background:#0f1720; border-color:#ffffff0e; }
  .submission-card-left { display:flex; align-items:center; gap:0.7rem; }
  .sub-file-icon { font-size:1.5rem; line-height:1; }
  .submission-meta { display:flex; flex-direction:column; gap:2px; }
  .submission-name { font-size:0.88rem; font-weight:600; color:var(--color-heading); }
  .submission-info { font-size:0.78rem; color:var(--color-sidebar-text); }
  .submission-actions { display:flex; gap:0.4rem; align-items:center; }

  .link-card { align-items:flex-start; }
  .link-card-body { display:flex; flex-direction:column; gap:3px; }
  .link-card-title { font-size:0.88rem; font-weight:600; color:var(--color-heading); }
  .link-card-url { font-size:0.8rem; color:#3b82f6; word-break:break-all; }
  .sub-open-btn {
    white-space:nowrap; padding:0.35rem 0.8rem; border-radius:0.4rem;
    font-size:0.8rem; font-weight:500; cursor:pointer;
    background:rgba(59,130,246,0.1); border:1px solid rgba(59,130,246,0.3); color:#3b82f6;
    transition:background 0.15s;
  }
  .sub-open-btn:hover { background:rgba(59,130,246,0.18); }

  .pending-upload .sub-input { width: 220px; }
  .pending-upload .submission-info { font-size:0.82rem; color:var(--color-sidebar-text); }

  .folder-list { display:flex; flex-direction:column; gap:0.5rem; padding:0.5rem 0.75rem 0.75rem; }
  .folder-block { border:1px solid var(--color-border,#e2e8f0); border-radius:8px; overflow:hidden; }
  :global(.dark) .folder-block { border-color:rgba(255,255,255,0.09); }

  .folder-header {
    display:flex; align-items:center; gap:0.4rem;
    padding:0.55rem 0.75rem;
    cursor:pointer;
    background:var(--color-surface,#f8fafc);
    user-select:none;
    transition:background 0.15s;
  }
  .folder-header:hover { background:var(--color-hover,#f1f5f9); }
  :global(.dark) .folder-header { background:rgba(255,255,255,0.04); }
  :global(.dark) .folder-header:hover { background:rgba(255,255,255,0.08); }

  .folder-chevron { font-size:0.75rem; color:var(--color-sidebar-text); width:12px; }
  .folder-icon { font-size:1rem; line-height:1; }
  .folder-name { flex:1; font-size:0.88rem; font-weight:600; color:var(--color-text,#1e293b); }
  :global(.dark) .folder-name { color:#e2e8f0; }

  .folder-rename-input {
    flex:1; font-size:0.88rem; font-weight:600;
    background:transparent; border:none; border-bottom:1.5px solid var(--color-primary,#6366f1);
    outline:none; padding:0 0.25rem; color:var(--color-text,#1e293b);
  }
  :global(.dark) .folder-rename-input { color:#e2e8f0; border-bottom-color:#818cf8; }

  .folder-rename-confirm {
    background:none; border:none; cursor:pointer;
    color:var(--color-primary,#6366f1); font-size:1rem; padding:0 0.2rem;
  }

  .folder-action-btn {
    background:none; border:none; cursor:pointer; padding:0.15rem 0.25rem;
    color:var(--color-sidebar-text); border-radius:4px; display:flex; align-items:center;
    opacity:0; transition:opacity 0.15s;
  }
  .folder-header:hover .folder-action-btn { opacity:1; }
  .folder-delete-btn:hover { color:#ef4444; }

  .folder-content { border-top:1px solid var(--color-border,#e2e8f0); }
  :global(.dark) .folder-content { border-top-color:rgba(255,255,255,0.08); }

  .proj-progress-overview { background:transparent; border-top:none; padding:0.35rem 1rem; }
  .feedback-wrap { display:flex; flex-direction:column; gap:0.6rem; }
  .fb-reply-input { width:100%; min-height:72px; resize:vertical; padding:0.6rem 0.8rem; border-radius:8px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text); font-size:0.9rem; }
  .fb-actions { display:flex; justify-content:flex-end; gap:0.5rem; margin-top:6px; }
  .fb-reply-btn { background:transparent; border:1px solid var(--color-border); padding:0.35rem 0.6rem; border-radius:6px; cursor:pointer; font-size:0.85rem; }
  .fb-reply-btn:hover { background:var(--color-soft); }

  .feedback-thread { display:flex; flex-direction:column; gap:8px; }
  .feedback-card { background:var(--color-surface); border:1px solid var(--color-border); padding:10px 12px; border-radius:8px; }
  .feedback-card-top { display:flex; align-items:center; justify-content:space-between; }
  .fb-role-badge { background:rgba(99,102,241,0.08); color:#6366f1; padding:4px 8px; border-radius:6px; font-weight:700; font-size:0.78rem; }
  .fb-meta { font-size:0.82rem; color:var(--color-sidebar-text); }
  .fb-comment-text { margin-top:6px; font-size:0.92rem; color:var(--color-text); }
  .fb-reply-compose { margin-top:8px; display:flex; flex-direction:column; gap:6px; }
  .feedback-reply { margin-left:28px; border-left:2px solid var(--color-border); padding-left:10px; display:flex; flex-direction:column; gap:6px; }
  :global(body.dark) .feedback-card { background:#0d1117; border-color:rgba(255,255,255,0.06); }

  </style>
