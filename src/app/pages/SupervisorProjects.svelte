<script>
// @ts-nocheck
  import { onMount, onDestroy } from 'svelte';
  import { getCurrentUser, subscribeToCurrentUser, callApiAction } from '../lib/auth.js';
  import { FolderOpen, Clock3, Tag, Users2, UserCheck, CalendarDays, Loader2, Grid, Archive, RotateCcw, Eye, Download, Plus, Trash2, Pencil, ExternalLink, Link2, Send, X } from 'lucide-svelte';
  import FeedbackThread from '../components/FeedbackThread.svelte';

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
  let feedbackLoadTokens = {};
  let postingFeedback = {};
  let replySubmitting = {};
  let newFeedbackText = {};
  const FEEDBACK_CACHE_PREFIX = 'projects.feedback.';
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
  let loadingFolderProjectIds = new Set();
  let isSavingFolder     = false;
  let isUploadingFile    = false;
  let isSavingLink       = false;
  let isSavingMilestone  = false;
  let isCreatingMilestone = false;
  let archivingProjectIds = new Set();
  let restoringProjectIds = new Set();
  let formError = '';
  let formSuccess = '';
  let showAddProjectModal = false;
  let isSubmittingProject = false;
  let projectFormError = '';
  let editingProjectId = null;
  let usersLoading = false;
  let bootstrapDepartment = '';
  let showMembersPanel = false;
  let showSupervisorsPanel = false;
  let memberSearch = '';
  let supervisorSearch = '';
  let membersSelectEl = null;
  let supervisorsSelectEl = null;
  const MAX_ASSIGNMENT_CHIPS = 3;
  const TEMP_FOLDER_PREFIX = 'tmp-folder-';
  const FOLDER_CACHE_PREFIX = 'projects.folders.';
  let showDeleteProjectModal = false;
  let projectToDelete = null;
  let isDeletingProject = false;
  let projectForm = {
    priority_level: 'Low',
    title: '',
    description: '',
    members: [],
    supervisor: [],
    timeline_start: '',
    timeline_end: '',
    status: 'Not Started'
  };

  function folderCacheKey(projectId) {
    return `${FOLDER_CACHE_PREFIX}${String(projectId || '').trim()}`;
  }

  function readCachedFolders(projectId) {
    try {
      const raw = localStorage.getItem(folderCacheKey(projectId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      return parsed.map((folder) => ({
        id: folder?.folder_id || folder?.id || '',
        folder_id: folder?.folder_id || folder?.id || '',
        name: String(folder?.name || '').trim(),
        gdrive_link: String(folder?.gdrive_link || '').trim(),
        created_by: String(folder?.created_by || '').trim(),
        submissions: Array.isArray(folder?.submissions) ? folder.submissions.map(normalizeSubmission_) : []
      }));
    } catch (e) {
      return null;
    }
  }

  function writeCachedFolders(projectId, folders) {
    try {
      localStorage.setItem(folderCacheKey(projectId), JSON.stringify(Array.isArray(folders) ? folders : []));
    } catch (e) {
      // ignore storage errors
    }
  }

  function feedbackCacheKey(projectId) {
    return `${FEEDBACK_CACHE_PREFIX}${String(projectId || '').trim()}`;
  }

  function readCachedFeedback(projectId) {
    try {
      const raw = localStorage.getItem(feedbackCacheKey(projectId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function writeCachedFeedback(projectId, feedback) {
    try {
      localStorage.setItem(feedbackCacheKey(projectId), JSON.stringify(Array.isArray(feedback) ? feedback : []));
    } catch (e) {
      // ignore storage errors
    }
  }

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

  function isTemporaryFolderId(folderId) {
    return String(folderId || '').startsWith(TEMP_FOLDER_PREFIX);
  }

  function getProjectFolderById(projectId, folderId) {
    const project = allProjects.find((p) => p.id === projectId);
    return (project?.folders || []).find((folder) => folder.id === folderId) || null;
  }

  function replaceFolderIdAcrossUi(oldId, nextFolder) {
    if (!oldId || !nextFolder?.id) return;

    allProjects = allProjects.map((project) => ({
      ...project,
      folders: (project.folders || []).map((folder) =>
        folder.id === oldId
          ? { ...folder, ...nextFolder, id: nextFolder.id, folder_id: nextFolder.folder_id || nextFolder.id }
          : folder
      ),
    }));

    if (expandedFolderIds.has(oldId)) {
      expandedFolderIds.delete(oldId);
      expandedFolderIds.add(nextFolder.id);
      expandedFolderIds = new Set(expandedFolderIds);
    }

    if (renamingFolderId === oldId) {
      renamingFolderId = nextFolder.id;
    }

    if (activeLinkFolderId === oldId) {
      activeLinkFolderId = nextFolder.id;
    }

    if (pendingUpload.folderId === oldId) {
      pendingUpload = { ...pendingUpload, folderId: nextFolder.id };
    }
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
    if (!ensureManageableProject(projectId, 'upload attachments to this project')) return;
    const el = document.getElementById(`proj-file-input-${projectId}-${folderId}`);
    if (el) el.click();
  }

  function handleFileSelect(projectId, folderId, ev) {
    if (!ensureManageableProject(projectId, 'upload attachments to this project')) {
      ev.target.value = '';
      return;
    }
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
    const project = ensureManageableProject(projectId, 'upload attachments to this project');
    if (!project) return;
    if (!pendingUpload || pendingUpload.projectId !== projectId || pendingUpload.folderId !== folderId || !pendingUpload.file) return;
    const file = pendingUpload.file;
    const chosenName = (String(pendingUpload.name || '').trim() || file.name.replace(/\.[^/.]+$/, '')) + (pendingUpload.ext ? '.' + pendingUpload.ext : '');
    const chosenKind = pendingUpload.type || 'Document';
    const ext = pendingUpload.ext || (file.name.match(/\.([^.]+)$/) || [])[1] || '';
    const mimeType = extToMime_(ext);
    const fileSizeMb = (file.size / (1024 * 1024)).toFixed(3);
    const projId = String(project?.proj_id || projectId);
    const uid = getCurrentUserId();
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

      const res = await callApiAction('create_proj_submission_supervisor', {
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
    const project = ensureManageableProject(projectId, 'add links to this project');
    if (!project) return;
    if (!String(viewingLinkUrl || '').trim()) { formError = 'Link URL is required.'; return; }
    if (isSavingLink) return;
    const projId = String(project?.proj_id || projectId);
    const uid = getCurrentUserId();
    formError = '';
    isSavingLink = true;
    try {
      const res = await callApiAction('create_proj_submission_supervisor', {
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
    } finally {
      isSavingLink = false;
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
    const project = ensureManageableProject(projectId, 'delete attachments from this project');
    if (!project) return;
    allProjects = allProjects.map(p => p.id === projectId ? {
      ...p,
      folders: (p.folders || []).map(f => f.id === folderId ? { ...f, submissions: (f.submissions || []).filter(s => s.id !== subId) } : f)
    } : p);
    try {
      const res = await callApiAction('delete_proj_submission_supervisor', {
        submission_id: subId,
        user_id: getCurrentUserId()
      });
      if (!res?.ok) { setFlashError(res?.error || 'Delete submission failed.'); return; }
      setFlashMessage('Submission removed.');
    } catch (e) { setFlashError(e?.message || 'Delete submission failed.'); }
  }

  function normalizeSubmission_(s) {
    const isFile = s.kind !== 'link';
    return {
      id:            s.submission_id,
      submission_id: s.submission_id,
      kind:          isFile ? 'file' : 'link',
      name:          s.file_name || '',
      file_type:     s.file_type || '',
      file_size:     s.file_size || '',
      uploaded_at:   s.uploaded_at || '',
      drive_url:     isFile ? (s.link_url || '') : '',
      gdrive:        s.gdrive || '',
      title:         !isFile ? (s.link_label || s.link_url || '') : '',
      url:           !isFile ? (s.link_url || '') : '',
      added_at:      !isFile ? (s.uploaded_at || '') : ''
    };
  }

  async function addFolder(projectId) {
    const project = ensureManageableProject(projectId, 'add folders to this project');
    if (!project) return;
    if (isSavingFolder) return;
    const uid = getCurrentUserId();
    const projId = String(project?.proj_id || projectId);
    const tempId = `${TEMP_FOLDER_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tempFolder = {
      id: tempId,
      folder_id: tempId,
      name: 'New Folder',
      gdrive_link: '',
      submissions: [],
      isPending: true
    };

    allProjects = allProjects.map((p) => p.id === projectId
      ? { ...p, folders: [...(p.folders || []), tempFolder] }
      : p);
    expandedFolderIds.add(tempId);
    expandedFolderIds = new Set(expandedFolderIds);
    renamingFolderId = tempId;
    renamingFolderName = 'New Folder';

    isSavingFolder = true;
    try {
      const res = await callApiAction('create_proj_folder_supervisor', {
        proj_id: projId,
        folder_name: 'New Folder',
        user_id: uid
      });
      if (!res?.ok) {
        allProjects = allProjects.map((p) => p.id === projectId
          ? { ...p, folders: (p.folders || []).filter((f) => f.id !== tempId) }
          : p);
        expandedFolderIds.delete(tempId);
        expandedFolderIds = new Set(expandedFolderIds);
        if (renamingFolderId === tempId) {
          renamingFolderId = null;
          renamingFolderName = '';
        }
        formError = res?.error || 'Failed to create folder.';
        return;
      }
      const newFolder = {
        id: res.folder_id,
        folder_id: res.folder_id,
        name: 'New Folder',
        gdrive_link: res.gdrive_link || '',
        submissions: [],
        isPending: false
      };
      const folderStillExists = Boolean(getProjectFolderById(projectId, tempId));
      if (!folderStillExists) {
        await callApiAction('delete_proj_folder_supervisor', {
          folder_id: res.folder_id,
          user_id: uid
        });
        return;
      }

      replaceFolderIdAcrossUi(tempId, newFolder);

      const currentFolderName = String(getProjectFolderById(projectId, res.folder_id)?.name || 'New Folder').trim() || 'New Folder';
      if (currentFolderName !== 'New Folder') {
        const renameRes = await callApiAction('update_proj_folder_supervisor', {
          folder_id: res.folder_id,
          folder_name: currentFolderName,
          user_id: uid
        });
        if (!renameRes?.ok) {
          formError = renameRes?.error || 'Rename failed.';
        }
      }
    } catch (e) {
      allProjects = allProjects.map((p) => p.id === projectId
        ? { ...p, folders: (p.folders || []).filter((f) => f.id !== tempId) }
        : p);
      expandedFolderIds.delete(tempId);
      expandedFolderIds = new Set(expandedFolderIds);
      if (renamingFolderId === tempId) {
        renamingFolderId = null;
        renamingFolderName = '';
      }
      formError = e?.message || 'Failed to create folder.';
    } finally {
      isSavingFolder = false;
    }
  }

  function startRenaming(folderId, currentName) {
    renamingFolderId = folderId;
    renamingFolderName = currentName;
  }

  async function confirmRename(projectId) {
    const project = ensureManageableProject(projectId, 'rename folders in this project');
    if (!project) return;
    if (!renamingFolderId) return;
    const newName = String(renamingFolderName || '').trim() || 'New Folder';
    const uid = getCurrentUserId();
    const savedId = renamingFolderId;
    const isTemporaryFolder = isTemporaryFolderId(savedId) || Boolean(getProjectFolderById(projectId, savedId)?.isPending);
    renamingFolderId = null;
    renamingFolderName = '';
    allProjects = allProjects.map(p => p.id === projectId ? {
      ...p,
      folders: (p.folders || []).map(f => f.id === savedId ? { ...f, name: newName } : f)
    } : p);
    if (isTemporaryFolder) return;
    try {
      const res = await callApiAction('update_proj_folder_supervisor', {
        folder_id: savedId,
        folder_name: newName,
        user_id: uid
      });
      if (!res?.ok) { formError = res?.error || 'Rename failed.'; }
    } catch (e) {
      formError = e?.message || 'Rename failed.';
    }
  }

  async function deleteFolder(projectId, folderId) {
    const project = ensureManageableProject(projectId, 'delete folders from this project');
    if (!project) return;
    const isTemporaryFolder = isTemporaryFolderId(folderId) || Boolean(getProjectFolderById(projectId, folderId)?.isPending);
    if (activeLinkFolderId === folderId) activeLinkFolderId = null;
    if (pendingUpload.folderId === folderId) cancelPendingUpload();
    allProjects = allProjects.map(p => p.id === projectId ? {
      ...p,
      folders: (p.folders || []).filter(f => f.id !== folderId)
    } : p);
    expandedFolderIds.delete(folderId);
    expandedFolderIds = new Set(expandedFolderIds);
    if (isTemporaryFolder) return;
    try {
      const res = await callApiAction('delete_proj_folder_supervisor', {
        folder_id: folderId,
        user_id: getCurrentUserId()
      });
      if (!res?.ok) { formError = res?.error || 'Delete folder failed.'; return; }
      formSuccess = 'Folder deleted.';
      setTimeout(() => { formSuccess = ''; }, 2000);
    } catch (e) {
      formError = e?.message || 'Delete folder failed.';
    }
  }

  let newMilestoneInputs = {};
  let newMilestoneLinkedFiles = {};
  let newMilestoneFilePicker = {};
  let editingMilestoneId = null;
  let editingMilestoneInputs = {};
  let showAddMilestoneFor = {};

  let expandedMilestoneIds = new Set();
  let milestoneFilePicker  = {};

  function toggleMilestoneExpand(milestoneId) {
    if (expandedMilestoneIds.has(milestoneId)) expandedMilestoneIds.delete(milestoneId);
    else expandedMilestoneIds.add(milestoneId);
    expandedMilestoneIds = new Set(expandedMilestoneIds);
  }

  function toggleMilestoneFilePicker(milestoneId) {
    milestoneFilePicker = { ...milestoneFilePicker, [milestoneId]: !milestoneFilePicker[milestoneId] };
  }

  function parseMilestoneFiles(m) {
    try { const v = m.linked_files || ''; if (!v) return []; return JSON.parse(v); } catch (e) { return []; }
  }

  function getNewMilestoneFiles(projectId) {
    return Array.isArray(newMilestoneLinkedFiles[projectId]) ? newMilestoneLinkedFiles[projectId] : [];
  }

  function toggleNewMilestoneFilePicker(projectId) {
    newMilestoneFilePicker = { ...newMilestoneFilePicker, [projectId]: !newMilestoneFilePicker[projectId] };
  }

  function toggleNewMilestoneFile(projectId, submission) {
    const current = getNewMilestoneFiles(projectId);
    const exists = current.find(f => f.id === submission.id);
    const updated = exists
      ? current.filter(f => f.id !== submission.id)
      : [...current, { id: submission.id, name: submission.name, drive_url: submission.drive_url || '' }];
    newMilestoneLinkedFiles = { ...newMilestoneLinkedFiles, [projectId]: updated };
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
    if (!ensureManageableProject(projectId, 'add milestones to this project')) return;
    const init = newMilestoneInputs[projectId] || { milestone: '', date: '' };
    newMilestoneInputs = { ...newMilestoneInputs, [projectId]: init };
    showAddMilestoneFor = { ...showAddMilestoneFor, [projectId]: !Boolean(showAddMilestoneFor[projectId]) };
  }

  async function createMilestone(projectId) {
    formError = '';
    const proj = ensureManageableProject(projectId, 'add milestones to this project');
    if (!proj) return;
    const projId = String(proj.proj_id || projectId);
    const inputs = newMilestoneInputs[projectId] || { milestone: '', date: '' };
    const text = String(inputs.milestone || '').trim();
    const date = String(inputs.date || '').trim();
    if (!text) { formError = 'Milestone text is required.'; return; }
    const uid = getCurrentUserId();
    const linkedFilesJson = JSON.stringify(getNewMilestoneFiles(projectId));
    isCreatingMilestone = true;
    try {
      const res = await callApiAction('create_milestone_supervisor', {
        proj_id: projId,
        milestone: text,
        date,
        status: 'Not Started',
        done: false,
        user_id: uid,
        linked_files: linkedFilesJson
      });
      if (!res?.ok) { formError = res?.error || 'Failed to create milestone.'; return; }
      const item = {
        id: res.milestone_id,
        milestone: text,
        date,
        status: 'Not Started',
        created_at: res.created_at,
        created_by: uid,
        done: false,
        linked_files: linkedFilesJson
      };
      allProjects = allProjects.map(p => p.id === projectId ? {
        ...p,
        milestones: [...(p.milestones || []), item]
      } : p);
      newMilestoneInputs = { ...newMilestoneInputs, [projectId]: { milestone: '', date: '' } };
      newMilestoneLinkedFiles = { ...newMilestoneLinkedFiles, [projectId]: [] };
      newMilestoneFilePicker = { ...newMilestoneFilePicker, [projectId]: false };
      showAddMilestoneFor = { ...showAddMilestoneFor, [projectId]: false };
      formSuccess = 'Milestone added.';
      setTimeout(() => { formSuccess = ''; }, 2000);
    } catch (e) {
      formError = e?.message || 'Failed to create milestone.';
    } finally {
      isCreatingMilestone = false;
    }
  }

  async function deleteMilestone(projectId, milestoneId) {
    const project = ensureManageableProject(projectId, 'delete milestones from this project');
    if (!project) return;
    if (!milestoneId) return;
    allProjects = allProjects.map(p => p.id === projectId ? {
      ...p,
      milestones: (p.milestones || []).filter(m => m.id !== milestoneId)
    } : p);
    try {
      const res = await callApiAction('delete_milestone_supervisor', {
        milestone_id: milestoneId,
        user_id: getCurrentUserId()
      });
      if (!res?.ok) { setFlashError(res?.error || 'Failed to delete milestone.'); return; }
      setFlashMessage('Milestone deleted.');
    } catch (e) {
      setFlashError(e?.message || 'Failed to delete milestone.');
    }
  }

  function startEditMilestone(projectId, m) {
    if (!ensureManageableProject(projectId, 'edit milestones in this project')) return;
    editingMilestoneId = m.id;
    editingMilestoneInputs = {
      ...editingMilestoneInputs,
      [m.id]: { milestone: m.milestone || '', date: m.date || '', status: m.status || 'Not Started' }
    };
  }

  function cancelEditMilestone() {
    editingMilestoneId = null;
  }

  async function saveEditedMilestone(projectId, milestoneId) {
    const project = ensureManageableProject(projectId, 'edit milestones in this project');
    if (!project) return;
    if (!milestoneId) return;
    const inputs = editingMilestoneInputs[milestoneId] || { milestone: '', date: '' };
    const text = String(inputs.milestone || '').trim();
    const date = String(inputs.date || '').trim();
    if (!text) { formError = 'Milestone text is required.'; return; }
    const uid = getCurrentUserId();
    isSavingMilestone = true;
    try {
      const res = await callApiAction('update_milestone_supervisor', {
        milestone_id: milestoneId,
        milestone: text,
        date,
        status: canonicalStatusLabel(inputs.status || 'Not Started'),
        user_id: uid
      });
      if (!res?.ok) { formError = res?.error || 'Failed to update milestone.'; return; }
      try {
        await loadProjectMilestones(projectId);
      } catch (e) {
        allProjects = allProjects.map(p => p.id === projectId ? {
          ...p,
          milestones: (p.milestones || []).map(mm => mm.id === milestoneId
            ? { ...mm, milestone: text, date, status: canonicalStatusLabel(inputs.status || 'Not Started') }
            : mm)
        } : p);
      }
      editingMilestoneId = null;
      formSuccess = 'Milestone updated.';
      setTimeout(() => { formSuccess = ''; }, 1500);
    } catch (e) {
      formError = e?.message || 'Failed to update milestone.';
    } finally {
      isSavingMilestone = false;
    }
  }

  async function changeMilestoneStatus(projectId, milestoneId, newStatus) {
    const project = ensureManageableProject(projectId, 'update milestone status in this project');
    if (!project) return;
    if (!milestoneId) return;
    const uid = getCurrentUserId();
    try {
      const res = await callApiAction('update_milestone_supervisor', {
        milestone_id: milestoneId,
        status: canonicalStatusLabel(newStatus || 'Not Started'),
        user_id: uid
      });
      if (!res?.ok) { setFlashError(res?.error || 'Failed to update status.'); return; }
      allProjects = allProjects.map(p => p.id === projectId ? {
        ...p,
        milestones: (p.milestones || []).map(mm => mm.id === milestoneId
          ? { ...mm, status: canonicalStatusLabel(newStatus || 'Not Started'), done: (String(newStatus || '').toLowerCase() === 'approved' || Boolean(mm.done)) }
          : mm)
      } : p);
      try { await loadProjectMilestones(projectId); } catch (e) {}
      setFlashMessage('Status updated.');
    } catch (e) {
      setFlashError(e?.message || 'Failed to update status.');
    }
  }

  async function toggleMilestoneFile(projectId, milestoneId, submission) {
    const project = ensureManageableProject(projectId, 'link files to milestones in this project');
    if (!project) return;
    const proj = allProjects.find(p => p.id === projectId);
    if (!proj) return;
    const m = (proj.milestones || []).find(x => x.id === milestoneId);
    if (!m) return;
    const current = parseMilestoneFiles(m);
    const exists = current.find(f => f.id === submission.id);
    const updated = exists
      ? current.filter(f => f.id !== submission.id)
      : [...current, { id: submission.id, name: submission.name, drive_url: submission.drive_url || '' }];
    const linkedJson = JSON.stringify(updated);
    const previousJson = JSON.stringify(current);
    const uid = getCurrentUserId();
    try {
      allProjects = allProjects.map(proj2 => proj2.id !== projectId ? proj2 : {
        ...proj2,
        milestones: (proj2.milestones || []).map(mm => mm.id === milestoneId ? { ...mm, linked_files: linkedJson } : mm)
      });

      const res = await callApiAction('update_milestone_supervisor', {
        milestone_id: milestoneId,
        linked_files: linkedJson,
        user_id: uid
      });
      if (!res?.ok) {
        allProjects = allProjects.map(proj2 => proj2.id !== projectId ? proj2 : {
          ...proj2,
          milestones: (proj2.milestones || []).map(mm => mm.id === milestoneId ? { ...mm, linked_files: previousJson } : mm)
        });
        formError = res?.error || 'Failed to update linked files.';
      }
    } catch (e) {
      allProjects = allProjects.map(proj2 => proj2.id !== projectId ? proj2 : {
        ...proj2,
        milestones: (proj2.milestones || []).map(mm => mm.id === milestoneId ? { ...mm, linked_files: previousJson } : mm)
      });
      formError = e?.message || 'Failed to update linked files.';
    }
  }

  // Feedback helpers
  let replyingTo = {};
  let replyText = {};

  function feedbackIdOf(item) {
    return item?.feedback_id || item?.id || '';
  }

  function toggleReply(projectId, feedbackId) {
    replyingTo = {
      ...replyingTo,
      [projectId]: replyingTo[projectId] === feedbackId ? null : feedbackId
    };
  }

  function updateReplyText(projectId, value) {
    replyText = { ...replyText, [projectId]: value };
  }

  function cancelReply(projectId) {
    replyingTo = { ...replyingTo, [projectId]: null };
  }

  function feedbackChildren(projectId, parentId) {
    const list = feedbackMap[projectId] || [];
    return list.filter(f => String(f.parent_id || '') === String(parentId || ''));
  }

  async function submitFeedback(projectId) {
    const text = String(newFeedbackText[projectId] || '').trim();
    if (!text) return;
    if (postingFeedback[projectId]) return;
    const uid  = String(currentUser?.user_id || getCurrentUser()?.user_id || '');
    const role = String(currentUser?.role || getCurrentUser()?.role || 'Supervisor');
    const activeUser = currentUser || getCurrentUser() || {};
    postingFeedback = { ...postingFeedback, [projectId]: true };
    try {
      const res = await callApiAction('create_feedback', { proj_id: String(projectId), user_id: uid, commenter_role: role, comment_text: text });
      if (!res?.ok) {
        setFlashError(res?.error || 'Failed to post comment.');
        return;
      }
      feedbackLoadTokens = { ...feedbackLoadTokens, [projectId]: (feedbackLoadTokens[projectId] || 0) + 1 };
      const createdItem = {
        feedback_id: String(res.feedback_id || `feedback-${Date.now()}`),
        proj_id: String(projectId),
        parent_id: '',
        commenter_id: uid,
        commenter_role: role,
        comment_text: text,
        created_at: String(res.created_at || new Date().toISOString()),
        commenter_name: getDisplayName(activeUser) || uid,
        _localPending: true
      };
      const nextFeedback = [...(feedbackMap[projectId] || []), createdItem];
      feedbackMap = { ...feedbackMap, [projectId]: nextFeedback };
      writeCachedFeedback(projectId, nextFeedback);
      newFeedbackText = { ...newFeedbackText, [projectId]: '' };
    } catch (e) {
      setFlashError(e?.message || 'Failed to post comment.');
    }
    finally {
      postingFeedback = { ...postingFeedback, [projectId]: false };
    }
  }

  async function submitReply(projectId, parentId) {
    const text = String(replyText[projectId] || '').trim();
    if (!text) return;
    if (replySubmitting[projectId]) return;
    const uid  = String(currentUser?.user_id || getCurrentUser()?.user_id || '');
    const role = String(currentUser?.role || getCurrentUser()?.role || 'Supervisor');
    const activeUser = currentUser || getCurrentUser() || {};
    replySubmitting = { ...replySubmitting, [projectId]: true };
    try {
      const res = await callApiAction('create_feedback', { proj_id: String(projectId), parent_id: String(parentId), user_id: uid, commenter_role: role, comment_text: text });
      if (!res?.ok) { setFlashError(res?.error || 'Failed to post reply.'); return; }
      feedbackLoadTokens = { ...feedbackLoadTokens, [projectId]: (feedbackLoadTokens[projectId] || 0) + 1 };
      const createdItem = {
        feedback_id: String(res.feedback_id || `feedback-${Date.now()}`),
        proj_id: String(projectId),
        parent_id: String(parentId),
        commenter_id: uid,
        commenter_role: role,
        comment_text: text,
        created_at: String(res.created_at || new Date().toISOString()),
        commenter_name: getDisplayName(activeUser) || uid,
        _localPending: true
      };
      const nextFeedback = [...(feedbackMap[projectId] || []), createdItem];
      feedbackMap = { ...feedbackMap, [projectId]: nextFeedback };
      writeCachedFeedback(projectId, nextFeedback);
      replyText = { ...replyText, [projectId]: '' };
      replyingTo = { ...replyingTo, [projectId]: null };
    } catch (e) { setFlashError(e?.message || 'Failed to post reply.'); }
    finally {
      replySubmitting = { ...replySubmitting, [projectId]: false };
    }
  }

  async function deleteFeedback(projectId, feedbackId) {
    const uid = String(currentUser?.user_id || getCurrentUser()?.user_id || '');
    try {
      const res = await callApiAction('delete_feedback', { feedback_id: feedbackId, user_id: uid });
      if (!res?.ok) { setFlashError(res?.error || 'Delete failed.'); return; }
      await loadFeedback(projectId, { silent: true });
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
      const id = getUserId(u);
      const name = getDisplayName(u);
      if (id) map[id] = name;
    });
    return map;
  }

  const ICONS = {
    folder: String.fromCodePoint(0x1F4C1),
    file: String.fromCodePoint(0x1F4C4),
    link: String.fromCodePoint(0x1F517),
    chevronRight: String.fromCodePoint(0x25B8),
    chevronDown: String.fromCodePoint(0x25BE),
    emDash: String.fromCodePoint(0x2014)
  };

  function getUserId(user) {
    return String(user?.user_id || user?.id || user?.UserId || user?.userId || user?.email || '').trim();
  }

  function getDisplayName(user) {
    if (!user || typeof user !== 'object') return '';
    const firstName = String(user?.first_name || user?.firstName || '').trim();
    const lastName = String(user?.last_name || user?.lastName || '').trim();
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    return String(
      user?.full_name ||
      user?.name ||
      user?.fullName ||
      user?.displayName ||
      fullName ||
      user?.email ||
      user?.user_id ||
      user?.id ||
      ''
    ).trim();
  }

  function getCurrentUserId() {
    return String(currentUser?.user_id || getCurrentUser()?.user_id || '').trim();
  }

  function canManageProject(project) {
    const currentUserId = getCurrentUserId();
    const projId = String(project?.proj_id || project?.id || '').trim();
    return Boolean(currentUserId && projId);
  }

  function canDeleteProject(project) {
    const currentUserId = getCurrentUserId();
    const creatorId = String(project?.created_by || '').trim();
    return Boolean(currentUserId && creatorId && currentUserId === creatorId);
  }

  function canArchiveProject(project) {
    const currentUserId = getCurrentUserId();
    const projId = String(project?.proj_id || project?.id || '').trim();
    const status = canonicalStatusLabel(project?.status || '').toLowerCase();
    return Boolean(currentUserId && projId && status === 'completed' && !project?.archived);
  }

  function ensureArchivableProject(projectOrId, actionLabel) {
    const project = typeof projectOrId === 'object'
      ? projectOrId
      : allProjects.find((item) => String(item.id || item.proj_id || '').trim() === String(projectOrId || '').trim());

    if (!project) {
      setFlashError('Project not found.');
      return null;
    }

    if (!canArchiveProject(project)) {
      setFlashError(`You cannot ${actionLabel}.`);
      return null;
    }

    return project;
  }

  function canRestoreProject(project) {
    const currentUserId = getCurrentUserId();
    const projId = String(project?.proj_id || project?.id || '').trim();
    return Boolean(currentUserId && projId && project?.archived);
  }

  function ensureRestorableProject(projectOrId, actionLabel) {
    const project = typeof projectOrId === 'object'
      ? projectOrId
      : allProjects.find((item) => String(item.id || item.proj_id || '').trim() === String(projectOrId || '').trim());

    if (!project) {
      setFlashError('Project not found.');
      return null;
    }

    if (!canRestoreProject(project)) {
      setFlashError(`You cannot ${actionLabel}.`);
      return null;
    }

    return project;
  }

  function showArchiveProject(project) {
    const currentUserId = getCurrentUserId();
    const projId = String(project?.proj_id || project?.id || '').trim();
    return Boolean(currentUserId && projId && !project?.archived);
  }

  function ensureManageableProject(projectOrId, actionLabel) {
    const project = typeof projectOrId === 'object'
      ? projectOrId
      : allProjects.find((item) => String(item.id || item.proj_id || '').trim() === String(projectOrId || '').trim());

    if (!project) {
      setFlashError('Project not found.');
      return null;
    }

    if (!canManageProject(project)) {
      setFlashError(`You do not have permission to ${actionLabel}.`);
      return null;
    }

    return project;
  }

  function ensureOwnedProject(projectOrId, actionLabel) {
    const project = typeof projectOrId === 'object'
      ? projectOrId
      : allProjects.find((item) => String(item.id || item.proj_id || '').trim() === String(projectOrId || '').trim());

    if (!project) {
      setFlashError('Project not found.');
      return null;
    }

    if (!canDeleteProject(project)) {
      setFlashError(`Only the supervisor who created this project can ${actionLabel}.`);
      return null;
    }

    return project;
  }

  function resetProjectForm() {
    const currentSupervisorId = getCurrentUserId();
    projectForm = {
      priority_level: 'Low',
      title: '',
      description: '',
      members: [],
      supervisor: currentSupervisorId ? [currentSupervisorId] : [],
      timeline_start: '',
      timeline_end: '',
      status: 'Not Started'
    };
    editingProjectId = null;
    projectFormError = '';
  }

  function validateProjectForm() {
    if (!String(projectForm.title || '').trim()) return 'Project title is required.';
    if (!String(projectForm.timeline_start || '').trim() || !String(projectForm.timeline_end || '').trim()) {
      return 'Timeline start and end are required.';
    }
    if (String(projectForm.timeline_end || '').trim() < String(projectForm.timeline_start || '').trim()) {
      return 'Timeline end must be on or after the timeline start.';
    }
    return '';
  }

  function normalizeText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function getDepartmentValue(user) {
    if (!user || typeof user !== 'object') return '';
    return user.department ?? user.Department ?? user.dept ?? user.Dept ?? user.departmentName ?? user.DepartmentName ?? '';
  }

  function sameDepartment(userDepartment, targetDepartment) {
    const userDept = normalizeText(userDepartment);
    const targetDept = normalizeText(targetDepartment);
    return Boolean(userDept && targetDept && userDept === targetDept);
  }

  function isInternUser(user) {
    const role = normalizeText(user?.role || user?.Role || user?.user_role || user?.userRole || '');
    return role.includes('intern') || role.includes('student') || role === 'ojt';
  }

  function isSupervisorUser(user) {
    const role = normalizeText(user?.role || user?.Role || user?.user_role || user?.userRole || '');
    return role.includes('supervisor') || role.includes('mentor');
  }

  function getProfilePhotoUrl(user) {
    return String(user?.profile_photo_url || user?.profilePhotoUrl || user?.photo_url || user?.avatar_url || '').trim();
  }

  function getInitials(nameValue) {
    const parts = String(nameValue || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    return (parts.map((part) => part.charAt(0)).join('') || '?').toUpperCase();
  }

  function getUserRecordById(userId) {
    const key = String(userId || '').trim();
    if (!key) return null;
    return (Array.isArray(users) ? users : []).find((user) => getUserId(user) === key) || null;
  }

  function buildProjectPersonList(ids) {
    return splitList(ids).map((id) => {
      const label = resolveUserName(id);
      const user = getUserRecordById(id);
      return {
        value: id,
        label: label || id,
        initials: getInitials(label || id),
        photoUrl: getProfilePhotoUrl(user)
      };
    });
  }

  function ensureCreatorIncludedSupervisorList(value) {
    const currentSupervisorId = String(getCurrentUserId() || '').trim();
    const next = Array.isArray(value) ? [...value] : splitList(value);
    if (currentSupervisorId && !next.includes(currentSupervisorId)) {
      next.push(currentSupervisorId);
    }
    return next;
  }

  function resolveUserName(userId) {
    const key = String(userId || '').trim();
    if (!key) return ICONS.emDash;
    if (userMap[key]) return userMap[key];
    const found = (Array.isArray(users) ? users : []).find((u) => getUserId(u) === key);
    if (found) return getDisplayName(found);
    return key;
  }
  let supervisorLabel = 'your supervisor account';
  let actionMessage = '';
  let actionError = '';
  let flashTimer;

  const PRIORITY_OPTIONS = ['Low', 'Medium', 'High'];
  const STATUS_OPTIONS = ['Not Started', 'In Progress', 'Review', 'Completed'];

  const DEFAULT_PRIORITY_COLOR = { bg: '#eef2f7', text: '#475569', border: '#cbd5e1' };
  const PRIORITY_COLORS = {
    'Low': { bg: '#f0f9ff', text: '#0369a1', border: '#bae6fd' },
    'Medium': { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
    'High': { bg: '#fff1f2', text: '#b91c1c', border: '#fecaca' }
  };

  const STATUS_META = {
    'Not Started': { cls: 'status-not-started', label: 'Not Started' },
    'In Progress': { cls: 'status-in-progress', label: 'In Progress' },
    'Review': { cls: 'status-needs-revision', label: 'Review' },
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

  function inferSingleDepartmentFromUsers(list) {
    const departments = new Set(
      (Array.isArray(list) ? list : [])
        .map((user) => normalizeText(getDepartmentValue(user)))
        .filter(Boolean)
    );
    return departments.size === 1 ? [...departments][0] : '';
  }

  function getProjectDepartmentContext() {
    return projectForm.department ?? projectForm.Department ?? projectForm.dept ?? projectForm.Dept ?? projectForm.departmentName ?? projectForm.DepartmentName
      ?? currentUser?.department ?? currentUser?.Department ?? currentUser?.dept ?? currentUser?.Dept
      ?? currentUser?.departmentName ?? currentUser?.DepartmentName
      ?? bootstrapDepartment
      ?? inferSingleDepartmentFromUsers(users)
      ?? '';
  }

  function assignmentEmptyMessage(type) {
    const isSupervisor = type === 'supervisor';
    if (usersLoading) return isSupervisor ? 'Loading supervisors...' : 'Loading interns...';
    if (!departmentContext && !allInterns.length && !allSupervisors.length) {
      return `Your department is missing. Update your profile department to select ${isSupervisor ? 'supervisors' : 'interns'}.`;
    }
    if (isSupervisor) return allSupervisors.length ? 'No supervisors found in your department' : 'No supervisors found';
    return allInterns.length ? 'No interns found in your department' : 'No interns found';
  }

  function normalizeBootstrapUsers(list) {
    const seen = new Set();
    const normalized = [];
    (Array.isArray(list) ? list : []).forEach((user) => {
      const id = getUserId(user);
      if (!id || seen.has(id)) return;
      seen.add(id);
      normalized.push({
        ...user,
        id,
        user_id: id,
        name: getDisplayName(user),
        full_name: user?.full_name || user?.name || user?.fullName || '',
        email: user?.email || '',
        role: user?.role || user?.Role || '',
        department: getDepartmentValue(user),
        profile_photo_url: getProfilePhotoUrl(user)
      });
    });
    return normalized;
  }

  function normalizePriorityLabel(value) {
    const raw = String(value || '').trim();
    const lower = raw.toLowerCase();
    if (lower === 'low') return 'Low';
    if (lower === 'medium') return 'Medium';
    if (lower === 'high') return 'High';
    return raw;
  }

  function getPriorityLabel(value) {
    return normalizePriorityLabel(value || 'Low');
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
    if (lower === 'review' || lower === 'revision' || lower === 'submitted' || lower === 'for review' || lower === 'needs revision') return 'Review';
    if (lower === 'completed' || lower === 'approved') return 'Completed';
    if (lower === 'pending') return 'Not Started';
    if (lower === 'archived') return 'Archived';
    return raw;
  }

  function statusGroup(value) {
    const label = canonicalStatusLabel(value).toLowerCase();
    if (label === 'completed') return 'completed';
    if (label === 'review') return 'review';
    if (label === 'in progress') return 'in progress';
    if (label === 'not started') return 'not started';
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

  function formatShortMonthDay(val) {
    const s = String(val || '').trim();
    if (!s) return '';

    let d;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) d = new Date(s + 'T00:00:00');
    else d = new Date(s);

    if (isNaN(d)) return s;

    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function statusToProgress(value) {
    const label = canonicalStatusLabel(value).toLowerCase();
    if (label === 'completed') return 100;
    if (label === 'review') return 70;
    if (label === 'in progress') return 50;
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

  function deadlineTimestamp(val) {
    const s = String(val || '').trim();
    if (!s) return Number.POSITIVE_INFINITY;
    const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s);
    const ts = d.getTime();
    return Number.isFinite(ts) ? ts : Number.POSITIVE_INFINITY;
  }

  function compareUpcomingDeadlineProjects(a, b) {
    const aValue = a?.timeline_end || a?.deadline || '';
    const bValue = b?.timeline_end || b?.deadline || '';
    const aCompleted = canonicalStatusLabel(a?.status) === 'Completed';
    const bCompleted = canonicalStatusLabel(b?.status) === 'Completed';
    if (aCompleted !== bCompleted) return aCompleted ? 1 : -1;
    const byDate = deadlineTimestamp(aValue) - deadlineTimestamp(bValue);
    if (byDate !== 0) return byDate;
    return String(a?.title || '').localeCompare(String(b?.title || ''));
  }

  function teamLabel(project) {
    const count = splitList(project?.members).length;
    if (!count) return ICONS.emDash;
    return `${count} ${count === 1 ? 'member' : 'members'}`;
  }

  function normalizeProject(project) {
    const priority = normalizePriorityLabel(project?.priority_level || project?.priority || 'Low');
    const status = canonicalStatusLabel(project?.status || 'Not Started');
    const archived = Boolean(project?.supervisor_archived ?? project?.archived);
    const progressPercentRaw = project?.progress_percent ?? project?.progress ?? project?.progressPercentage ?? null;
    const progressPercent = progressPercentRaw === null || progressPercentRaw === undefined || progressPercentRaw === ''
      ? null
      : Number(progressPercentRaw);

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
      archived,
      supervisor_archived: archived,
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
      progress_percent: Number.isFinite(progressPercent) ? progressPercent : null
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

  function toggleMember(value) {
    const next = Array.isArray(projectForm.members) ? [...projectForm.members] : [];
    const idx = next.indexOf(value);
    if (idx === -1) next.push(value);
    else next.splice(idx, 1);
    projectForm = { ...projectForm, members: next };
  }

  function toggleSupervisor(value) {
    const currentSupervisorId = String(getCurrentUserId() || '').trim();
    if (currentSupervisorId && String(value || '').trim() === currentSupervisorId) {
      return;
    }
    const next = Array.isArray(projectForm.supervisor) ? [...projectForm.supervisor] : [];
    const idx = next.indexOf(value);
    if (idx === -1) next.push(value);
    else next.splice(idx, 1);
    projectForm = { ...projectForm, supervisor: ensureCreatorIncludedSupervisorList(next) };
  }

  function toggleMembersDropdown() {
    showMembersPanel = !showMembersPanel;
    if (showMembersPanel) showSupervisorsPanel = false;
  }

  function toggleSupervisorsDropdown() {
    showSupervisorsPanel = !showSupervisorsPanel;
    if (showSupervisorsPanel) showMembersPanel = false;
  }

  function filterAssignmentOptions(options, query) {
    const needle = normalizeText(query);
    if (!needle) return options;
    return options.filter((option) => normalizeText(`${option.label} ${option.email || ''}`).includes(needle));
  }

  function openAddProjectModal() {
    resetProjectForm();
    showMembersPanel = false;
    showSupervisorsPanel = false;
    memberSearch = '';
    supervisorSearch = '';
    showAddProjectModal = true;
  }

  function openEditProjectModal(project) {
    const target = ensureManageableProject(project, 'edit this project');
    if (!target) return;

    editingProjectId = String(target.id || target.proj_id || '').trim();
    projectForm = {
      priority_level: normalizePriorityLabel(target.priority_level || target.priority || 'Low'),
      title: String(target.title || target.proj_name || '').trim(),
      description: String(target.description || '').trim(),
      members: Array.isArray(target.members) ? [...target.members] : splitList(target.members),
      supervisor: ensureCreatorIncludedSupervisorList(
        Array.isArray(target.supervisors) ? [...target.supervisors] : splitList(target.supervisor)
      ),
      timeline_start: String(target.timeline_start || '').trim(),
      timeline_end: String(target.timeline_end || target.deadline || '').trim(),
      status: canonicalStatusLabel(target.status || 'Not Started')
    };
    projectFormError = '';
    showMembersPanel = false;
    showSupervisorsPanel = false;
    memberSearch = '';
    supervisorSearch = '';
    showAddProjectModal = true;
  }

  function closeAddProjectModal() {
    showAddProjectModal = false;
    showMembersPanel = false;
    showSupervisorsPanel = false;
    memberSearch = '';
    supervisorSearch = '';
    resetProjectForm();
  }

  function handleModalPointerDown(event) {
    if (!showAddProjectModal) return;
    const target = event.target;
    if (showMembersPanel && membersSelectEl && !membersSelectEl.contains(target)) {
      showMembersPanel = false;
    }
    if (showSupervisorsPanel && supervisorsSelectEl && !supervisorsSelectEl.contains(target)) {
      showSupervisorsPanel = false;
    }
  }

  async function submitProject() {
    const err = validateProjectForm();
    projectFormError = err;
    if (err) return;

    const supervisorId = getCurrentUserId();
    if (!supervisorId) {
      projectFormError = 'No supervisor account found.';
      return;
    }

    isSubmittingProject = true;
    try {
      const isEditing = Boolean(editingProjectId);
      const action = editingProjectId ? 'update_proj_supervisor' : 'create_proj_supervisor';
      const supervisorSelection = ensureCreatorIncludedSupervisorList(projectForm.supervisor);
      const result = await callApiAction(action, {
        user_id: supervisorId,
        proj_id: editingProjectId || '',
        proj_name: projectForm.title,
        description: projectForm.description,
        priority: projectForm.priority_level,
        status: canonicalStatusLabel(projectForm.status),
        members: projectForm.members,
        supervisor: supervisorSelection,
        start_date: projectForm.timeline_start,
        end_date: projectForm.timeline_end
      });

      if (!result?.ok) {
        projectFormError = result?.error || (editingProjectId ? 'Update failed.' : 'Create failed.');
        return;
      }

      const creatorName = getDisplayName(currentUser || getCurrentUser() || {}) || supervisorId;
      const updatedProject = normalizeProject({
        proj_id: result.proj_id || editingProjectId,
        proj_name: projectForm.title,
        description: projectForm.description,
        priority: projectForm.priority_level,
        status: canonicalStatusLabel(projectForm.status),
        members: Array.isArray(result.members) ? result.members : projectForm.members,
        supervisor: Array.isArray(result.supervisor) ? result.supervisor : supervisorSelection,
        start_date: projectForm.timeline_start,
        end_date: projectForm.timeline_end,
        created_at: new Date().toISOString(),
        created_by: supervisorId,
        created_by_name: creatorName,
        owner_name: creatorName
      });

      if (isEditing) {
        allProjects = allProjects.map((item) => (
          item.id === editingProjectId
            ? {
                ...item,
                ...updatedProject,
                created_at: item.created_at,
                created_by: item.created_by,
                created_by_name: item.created_by_name || updatedProject.created_by_name,
                owner_name: item.owner_name || updatedProject.owner_name
              }
            : item
        )).sort(sortProjects);
      } else {
        allProjects = [...allProjects, updatedProject].sort(sortProjects);
      }
      activeView = 'Projects';
      filterPriority = 'all';
      filterStatus = 'all';
      filterIntern = 'all';
      if (!isEditing) {
        searchQuery = '';
      }
      closeAddProjectModal();
      setFlashMessage(isEditing ? 'Project updated successfully.' : 'Project added successfully.');
    } catch (error) {
      projectFormError = error?.message || (editingProjectId ? 'Update failed.' : 'Create failed.');
    } finally {
      isSubmittingProject = false;
    }
  }

  function openDeleteProjectModal(project) {
    const target = ensureOwnedProject(project, 'delete this project');
    if (!target) return;
    projectToDelete = target;
    showDeleteProjectModal = true;
  }

  function closeDeleteProjectModal() {
    projectToDelete = null;
    showDeleteProjectModal = false;
  }

  async function confirmDeleteProject() {
    const project = ensureOwnedProject(projectToDelete, 'delete this project');
    if (!project) {
      closeDeleteProjectModal();
      return;
    }

    isDeletingProject = true;
    try {
      const res = await callApiAction('delete_proj_supervisor', {
        proj_id: project.proj_id || project.id,
        user_id: getCurrentUserId()
      });
      if (!res?.ok) {
        setFlashError(res?.error || 'Delete failed.');
        return;
      }

      allProjects = allProjects.filter((item) => item.id !== project.id);
      if (viewingProjectId === project.id) {
        viewingProjectId = null;
        try { localStorage.removeItem('projects.viewingProjectId'); } catch (e) {}
      }
      if (String(searchQuery || '').trim().toLowerCase() === String(project.title || '').trim().toLowerCase()) {
        searchQuery = '';
      }
      setFlashMessage('Project deleted.');
      closeDeleteProjectModal();
    } catch (error) {
      setFlashError(error?.message || 'Delete failed.');
    } finally {
      isDeletingProject = false;
    }
  }

  async function loadProjects() {
    isLoading = true;
    usersLoading = true;
    loadError = '';

    try {
      const supervisorId = String(currentUser?.user_id || getCurrentUser()?.user_id || '').trim();
      if (!supervisorId) {
        allProjects = [];
        users = [];
        userMap = {};
        bootstrapDepartment = '';
        return;
      }

      users = [];
      userMap = {};
      bootstrapDepartment = '';

      const [projectsResult, bootstrapResult] = await Promise.allSettled([
        callApiAction('list_proj_supervisor', { supervisor_user_id: supervisorId }),
        callApiAction('get_proj_users_bootstrap', { user_id: supervisorId })
      ]);

      const result = projectsResult.status === 'fulfilled' ? projectsResult.value : null;
      const boot = bootstrapResult.status === 'fulfilled' ? bootstrapResult.value : null;

      if (boot?.ok) {
        bootstrapDepartment = String(boot.department || boot.Department || boot.dept || '').trim();
        const list = Array.isArray(boot.users) ? boot.users : [...(boot.interns || []), ...(boot.supervisors || [])];
        users = normalizeBootstrapUsers(list);
        userMap = buildUserMap(users);
      }

      if (projectsResult.status === 'rejected') {
        throw projectsResult.reason instanceof Error
          ? projectsResult.reason
          : new Error(String(projectsResult.reason || 'Unable to load supervisor projects.'));
      }

      allProjects = (result?.projects || []).map(normalizeProject).map((project) => {
        const cachedFeedback = readCachedFeedback(project.id);
        if (cachedFeedback && !(project.id in feedbackMap)) {
          feedbackMap = { ...feedbackMap, [project.id]: cachedFeedback };
        }
        return {
          ...project,
          folders: readCachedFolders(project.id) || project.folders || null
        };
      }).sort(sortProjects);

      for (const project of allProjects) {
        void loadProjectFolders(project.id, { showSpinner: false, hydrateFromCache: false });
        void loadFeedback(project.id, { silent: true, hydrateFromCache: false });
      }

      try {
        const saved = localStorage.getItem('projects.viewingProjectId');
        if (saved) {
          const found = allProjects.find(x => x.id === saved);
          if (found) {
            viewingProjectId = saved;
            viewingProjectTab = 'Details';
            if (!found.folders || found.folders === null) loadProjectFolders(saved, { showSpinner: false });
          }
        }
      } catch (e) {
        // ignore storage errors
      }
    } catch (error) {
      allProjects = [];
      users = [];
      userMap = {};
      bootstrapDepartment = '';
      loadError = error?.message || 'Unable to load supervisor projects.';
    } finally {
      isLoading = false;
      usersLoading = false;
    }
  }

  onMount(() => {
    currentUser = getCurrentUser() || currentUser;
    document.addEventListener('mousedown', handleModalPointerDown);
    window.addEventListener('resize', handleResize);
    unsubscribeAuth = subscribeToCurrentUser((u) => {
      currentUser = u;
      loadProjects();
    });
  });

  onDestroy(() => {
    document.removeEventListener('mousedown', handleModalPointerDown);
    window.removeEventListener('resize', handleResize);
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

  function showOverviewView() {
    activeView = 'Overview';
    closeProjectModal();
  }

  function showProjectsView() {
    activeView = 'Projects';
    closeProjectModal();
  }

  function showArchiveView() {
    activeView = 'Archive';
    closeProjectModal();
  }

  function viewProject(project) {
    if (!project) return;
    viewingProjectId = project.id;
    viewingProjectTab = 'Details';
    try { localStorage.setItem('projects.viewingProjectId', String(project.id)); } catch (e) {}
    if (!project.folders || project.folders === null) loadProjectFolders(project.id, { showSpinner: false });
  }

  function closeProjectModal() {
    viewingProjectId = null;
    viewingProjectTab = 'Details';
    try { localStorage.removeItem('projects.viewingProjectId'); } catch (e) {}
  }

  async function loadProjectFolders(projectId, options = {}) {
    const { showSpinner = false, hydrateFromCache = true } = options;
    const projectKey = String(projectId || '').trim();
    if (!projectKey || loadingFolderProjectIds.has(projectKey)) return;

    const currentProject = allProjects.find((p) => p.id === projectId);
    if (hydrateFromCache && (!currentProject?.folders || currentProject.folders === null)) {
      const cachedFolders = readCachedFolders(projectKey);
      if (cachedFolders) {
        allProjects = allProjects.map((p) => p.id === projectId ? { ...p, folders: cachedFolders } : p);
      }
    }

    const projId = String(currentProject?.proj_id || projectId);
    loadingFolderProjectIds.add(projectKey);
    loadingFolderProjectIds = new Set(loadingFolderProjectIds);
    if (showSpinner) isLoadingFolders = true;
    try {
      const res = await callApiAction('list_proj_submissions', { proj_id: projId });
      if (res?.ok) {
        const folders = (res.folders || []).map(f => ({
          id:          f.folder_id,
          folder_id:   f.folder_id,
          name:        f.folder_name,
          gdrive_link: f.gdrive_link,
          created_by:  f.created_by,
          submissions: (f.submissions || []).map(normalizeSubmission_)
        }));
        allProjects = allProjects.map(p => p.id === projectId ? { ...p, folders } : p);
        writeCachedFolders(projectKey, folders);
      } else {
        allProjects = allProjects.map(p => p.id === projectId ? { ...p, folders: [] } : p);
        writeCachedFolders(projectKey, []);
      }
    } catch (e) {
      console.error('loadProjectFolders error', e);
      allProjects = allProjects.map(p => p.id === projectId ? { ...p, folders: [] } : p);
    } finally {
      loadingFolderProjectIds.delete(projectKey);
      loadingFolderProjectIds = new Set(loadingFolderProjectIds);
      if (showSpinner) isLoadingFolders = false;
    }
  }

  async function loadProjectMilestones(projectId) {
    const projId = String(allProjects.find(p => p.id === projectId)?.proj_id || projectId);
    try {
      const res = await callApiAction('list_milestones', { proj_id: projId });
      if (res?.ok) {
        const list = (res.milestones || []).map(m => ({ id: m.milestone_id, milestone: m.milestone, date: m.date, status: canonicalStatusLabel(m.status || 'Not Started'), done: Boolean(m.done), created_at: m.created_at, created_by: m.created_by, linked_files: m.linked_files || '' }));
        allProjects = allProjects.map(p => p.id === projectId ? { ...p, milestones: list } : p);
        try { localStorage.setItem('projects.milestones.' + String(projectId), JSON.stringify(list)); } catch (e) {}
      } else {
        allProjects = allProjects.map(p => p.id === projectId ? { ...p, milestones: [] } : p);
        try { localStorage.setItem('projects.milestones.' + String(projectId), JSON.stringify([])); } catch (e) {}
      }
    } catch (e) {
      console.error('loadProjectMilestones error', e);
      let cached = null;
      try { cached = localStorage.getItem('projects.milestones.' + String(projectId)); } catch (ee) { cached = null; }
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          allProjects = allProjects.map(p => p.id === projectId
            ? { ...p, milestones: Array.isArray(parsed) ? parsed.map(mm => ({ ...mm, status: canonicalStatusLabel(mm.status || 'Not Started') })) : [] }
            : p);
        } catch (ee) {
          allProjects = allProjects.map(p => p.id === projectId ? { ...p, milestones: [] } : p);
        }
      } else {
        allProjects = allProjects.map(p => p.id === projectId ? { ...p, milestones: [] } : p);
      }
    }
  }

  async function loadFeedback(projectId, { silent = false, hydrateFromCache = true } = {}) {
    const token = (feedbackLoadTokens[projectId] || 0) + 1;
    feedbackLoadTokens = { ...feedbackLoadTokens, [projectId]: token };
    if (hydrateFromCache && !(projectId in feedbackMap)) {
      const cachedFeedback = readCachedFeedback(projectId);
      feedbackMap = { ...feedbackMap, [projectId]: cachedFeedback || [] };
    }
    if (!silent) feedbackLoading = { ...feedbackLoading, [projectId]: true };
    try {
      const res = await callApiAction('list_feedback', { proj_id: String(projectId) });
      if (feedbackLoadTokens[projectId] !== token) return;
      if (res?.ok) {
        const serverFeedback = res.feedback || [];
        const serverIds = new Set(serverFeedback.map((item) => String(feedbackIdOf(item) || '').trim()).filter(Boolean));
        const localPending = (feedbackMap[projectId] || []).filter((item) => item?._localPending);
        const mergedFeedback = [
          ...serverFeedback.map((item) => ({ ...item, _localPending: false })),
          ...localPending.filter((item) => !serverIds.has(String(feedbackIdOf(item) || '').trim()))
        ];
        feedbackMap = { ...feedbackMap, [projectId]: mergedFeedback };
        writeCachedFeedback(projectId, mergedFeedback);
      } else {
        feedbackMap = { ...feedbackMap, [projectId]: [] };
        writeCachedFeedback(projectId, []);
      }
    } catch (e) {
      if (feedbackLoadTokens[projectId] !== token) return;
      if (!(projectId in feedbackMap)) {
        feedbackMap = { ...feedbackMap, [projectId]: [] };
      }
    } finally {
      if (!silent && feedbackLoadTokens[projectId] === token) {
        feedbackLoading = { ...feedbackLoading, [projectId]: false };
      }
    }
  }

  async function archiveProject(project) {
    const targetProject = ensureArchivableProject(project, 'archive this project');
    const projectId = String(targetProject?.id || targetProject?.proj_id || '').trim();
    if (!targetProject || targetProject.archived || !projectId || archivingProjectIds.has(projectId)) return;

    archivingProjectIds = new Set([...archivingProjectIds, projectId]);

    try {
      const result = await callApiAction('update_proj_supervisor', {
        proj_id: targetProject.proj_id || targetProject.id,
        user_id: getCurrentUserId(),
        status: 'Archived'
      });

      if (!result?.ok) {
        setFlashError(result?.error || 'Archive failed.');
        return;
      }

      allProjects = allProjects.map((item) => (
        item.id === targetProject.id
          ? { ...item, archived: true, supervisor_archived: true }
          : item
      ));
      if (viewingProjectId === targetProject.id) {
        viewingProjectId = null;
        try { localStorage.removeItem('projects.viewingProjectId'); } catch (e) {}
      }
      if (String(searchQuery || '').trim().toLowerCase() === String(targetProject.title || '').trim().toLowerCase()) {
        searchQuery = '';
      }
      setFlashMessage('Project archived.');
    } catch (error) {
      setFlashError(error?.message || 'Archive failed.');
    } finally {
      const next = new Set(archivingProjectIds);
      next.delete(projectId);
      archivingProjectIds = next;
    }
  }

  async function restoreProject(project) {
    const targetProject = ensureRestorableProject(project, 'restore this project');
    const projectId = String(targetProject?.id || targetProject?.proj_id || '').trim();
    if (!targetProject || !projectId || restoringProjectIds.has(projectId)) return;

    restoringProjectIds = new Set([...restoringProjectIds, projectId]);

    try {
      const result = await callApiAction('restore_proj_supervisor', {
        proj_id: targetProject.proj_id || targetProject.id,
        user_id: getCurrentUserId()
      });

      if (!result?.ok) {
        setFlashError(result?.error || 'Restore failed.');
        return;
      }

      allProjects = allProjects.map((item) => (
        item.id === targetProject.id
          ? { ...item, archived: false, supervisor_archived: false, status: canonicalStatusLabel(result.status || item.status || 'Not Started') }
          : item
      ));
      if (String(searchQuery || '').trim().toLowerCase() === String(targetProject.title || '').trim().toLowerCase()) {
        searchQuery = '';
      }
      activeView = 'Projects';
      setFlashMessage('Project restored.');
    } catch (error) {
      setFlashError(error?.message || 'Restore failed.');
    } finally {
      const next = new Set(restoringProjectIds);
      next.delete(projectId);
      restoringProjectIds = next;
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

  $: departmentContext = normalizeText(getProjectDepartmentContext());
  $: allInterns = users.filter(isInternUser);
  $: allSupervisors = users.filter(isSupervisorUser);
  $: availableInterns = departmentContext
    ? allInterns.filter((user) => sameDepartment(getDepartmentValue(user), departmentContext))
    : allInterns;
  $: availableSupervisors = departmentContext
    ? allSupervisors.filter((user) => sameDepartment(getDepartmentValue(user), departmentContext))
    : allSupervisors;
  $: MEMBER_OPTIONS = availableInterns.map((user) => ({
    value: getUserId(user),
    label: getDisplayName(user),
    email: user?.email || '',
    photoUrl: getProfilePhotoUrl(user),
    initials: getInitials(getDisplayName(user))
  })).filter((option) => option.value);
  $: SUPERVISOR_OPTIONS = availableSupervisors.map((user) => ({
    value: getUserId(user),
    label: getDisplayName(user),
    email: user?.email || '',
    photoUrl: getProfilePhotoUrl(user),
    initials: getInitials(getDisplayName(user))
  })).filter((option) => option.value);
  $: selectedMemberOptions = (projectForm.members || []).map((id) => (
    MEMBER_OPTIONS.find((option) => option.value === id) || { value: id, label: id, initials: getInitials(id) }
  ));
  $: selectedSupervisorOptions = (projectForm.supervisor || []).map((id) => (
    SUPERVISOR_OPTIONS.find((option) => option.value === id) || { value: id, label: id, initials: getInitials(id) }
  ));
  $: memberChipList = selectedMemberOptions;
  $: supervisorChipList = selectedSupervisorOptions.slice(0, MAX_ASSIGNMENT_CHIPS);
  $: filteredMemberOptions = filterAssignmentOptions(MEMBER_OPTIONS, memberSearch);
  $: filteredSupervisorOptions = filterAssignmentOptions(SUPERVISOR_OPTIONS, supervisorSearch);
  $: isProjectFormValid =
    String(projectForm.title || '').trim() &&
    String(projectForm.timeline_start || '').trim() &&
    String(projectForm.timeline_end || '').trim() &&
    String(projectForm.timeline_end || '').trim() >= String(projectForm.timeline_start || '').trim();
  $: if (
    String(projectForm.timeline_start || '').trim() &&
    String(projectForm.timeline_end || '').trim() &&
    String(projectForm.timeline_end || '').trim() < String(projectForm.timeline_start || '').trim()
  ) {
    projectForm = { ...projectForm, timeline_end: projectForm.timeline_start };
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
  $: reviewCount = activeProjects.filter((p) => statusGroup(p.status) === 'review').length;
  $: internCount = uniqueInterns.length;
  $: archivedCount = archivedProjects.length;
  $: workloadRows = Object.values(
    activeProjects.reduce((acc, project) => {
      const memberIds = Array.isArray(project.members) ? project.members : splitList(project.members);
      const fallbackName = String(project.owner_name || resolveUserName(project.created_by) || '').trim() || 'Unknown intern';
      const participantNames = memberIds.length
        ? memberIds
            .map((memberId) => {
              const normalizedId = String(memberId || '').trim();
              const userRecord = (Array.isArray(users) ? users : []).find((user) => getUserId(user) === normalizedId);
              return isInternUser(userRecord) ? resolveUserName(normalizedId) : '';
            })
            .filter(Boolean)
        : [fallbackName];

      participantNames.forEach((internName) => {
        if (!acc[internName]) {
          acc[internName] = {
            internName,
            totalAssigned: 0,
            completedCount: 0
          };
        }
        acc[internName].totalAssigned += 1;
        if (canonicalStatusLabel(project.status) === 'Completed') {
          acc[internName].completedCount += 1;
        }
      });
      return acc;
    }, {})
  )
    .map((row) => ({
      ...row,
      pct: row.totalAssigned > 0 ? Math.round((row.completedCount / row.totalAssigned) * 100) : 0
    }))
    .sort((a, b) => b.completedCount - a.completedCount || b.totalAssigned - a.totalAssigned || a.internName.localeCompare(b.internName))
    .slice(0, 4);
  $: upcomingDeadlines = activeProjects
    .filter((p) => String(p.timeline_end || p.deadline || '').trim())
    .sort(compareUpcomingDeadlineProjects)
    .slice(0, 5);
  $: overviewSnippets = activeProjects;
  $: selectedViewingProject = allProjects.find((p) => p.id === viewingProjectId) || null;

  // Tagged Projects pagination
  let taggedProjectsPage = 0;
  let windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;

  function handleResize() {
    const prev = windowWidth;
    windowWidth = window.innerWidth;
    // Reset to page 0 if the layout switches between desktop and mobile card counts
    if ((prev <= 768) !== (windowWidth <= 768)) taggedProjectsPage = 0;
  }

  $: taggedProjectsPerPage = windowWidth <= 768 ? 2 : 4;
  $: taggedProjectPageCount = Math.ceil(overviewSnippets.length / taggedProjectsPerPage);
  $: pagedTaggedSnippets = overviewSnippets.slice(
    taggedProjectsPage * taggedProjectsPerPage,
    taggedProjectsPage * taggedProjectsPerPage + taggedProjectsPerPage
  );
  $: {
    if (taggedProjectPageCount === 0 && taggedProjectsPage !== 0) {
      taggedProjectsPage = 0;
    } else if (taggedProjectPageCount > 0 && taggedProjectsPage > taggedProjectPageCount - 1) {
      taggedProjectsPage = taggedProjectPageCount - 1;
    }
  }
</script>

<section class="projects-page">
  <div class="stat-cards">
    {#if isLoading}
      {#each [1, 2, 3, 4] as _}
        <div class="stat-card stat-card-skeleton" aria-hidden="true">
          <div class="stat-icon stat-icon-skeleton ov-skeleton shimmer"></div>
          <div class="stat-body stat-body-skeleton">
            <div class="ov-skeleton shimmer" style="height: 11px; width: 108px;"></div>
            <div class="ov-skeleton shimmer" style="height: 24px; width: 34px;"></div>
            <div class="ov-skeleton shimmer" style="height: 11px; width: 132px;"></div>
          </div>
        </div>
      {/each}
    {:else}
      <div class="stat-card">
        <div class="stat-icon tone-blue"><FolderOpen size={16} /></div>
        <div class="stat-body">
          <div class="stat-label">Total Projects</div>
          <div class="stat-value">{totalProjects}</div>
          <div class="stat-sub">Projects tagged to you</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon tone-amber"><Clock3 size={16} /></div>
        <div class="stat-body">
          <div class="stat-label">In Progress</div>
          <div class="stat-value">{inProgressCount}</div>
          <div class="stat-sub">Currently active projects</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon tone-green"><Tag size={16} /></div>
        <div class="stat-body">
          <div class="stat-label">Review</div>
          <div class="stat-value">{reviewCount}</div>
          <div class="stat-sub">Waiting on requested updates</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon tone-violet"><Users2 size={16} /></div>
        <div class="stat-body">
          <div class="stat-label">Interns</div>
          <div class="stat-value">{internCount}</div>
          <div class="stat-sub">Contributors on your tagged projects</div>
        </div>
      </div>
    {/if}
  </div>

  <section class="quick-panel">
    <div class="quick-head">
      <div class="view-controls">
        <button type="button" class="btn btn-ghost" class:active={activeView === 'Overview'} on:click={showOverviewView}>
          <Grid size={14} />
          <span>Overview</span>
        </button>
        <button type="button" class="btn btn-ghost" class:active={activeView === 'Projects'} on:click={showProjectsView}>
          <FolderOpen size={14} />
          <span>Projects</span>
        </button>
        <button type="button" class="btn btn-ghost" class:active={activeView === 'Archive'} on:click={showArchiveView}>
          <Archive size={14} />
          <span>Archive</span>
        </button>
      </div>

      <div class="quick-actions">
        {#if activeView === 'Projects'}
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
        {/if}

        <button type="button" class="primary" on:click={openAddProjectModal}>
          <Plus size={14} />
          <span>Add Project</span>
        </button>
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
    <div class="loading-shell" aria-hidden="true">
      <section class="card ov-card">
        <div class="ov-card-head">
          <div class="ov-skeleton shimmer" style="height: 14px; width: 130px;"></div>
          <div class="ov-skeleton shimmer" style="height: 12px; width: 80px;"></div>
        </div>
        <div class="ov-snippets-grid">
          {#each [1, 2, 3, 4] as _}
            <div class="ov-snippet-card ov-snippet-skeleton">
              <div class="ov-snippet-top">
                <div class="ov-skeleton shimmer" style="height: 12px; width: 55%;"></div>
                <div class="ov-snippet-top-right">
                  <div class="ov-skeleton shimmer" style="height: 20px; width: 82px; border-radius: 999px;"></div>
                  <div class="ov-skeleton shimmer" style="height: 20px; width: 62px; border-radius: 999px;"></div>
                </div>
              </div>
              <div class="ov-skeleton shimmer" style="height: 8px; width: 100%; border-radius: 999px;"></div>
              <div class="ov-skeleton shimmer" style="height: 11px; width: 130px;"></div>
              <div class="ov-snippet-actions">
                <div class="ov-skeleton shimmer" style="height: 28px; width: 100%; border-radius: 8px;"></div>
                <div class="ov-skeleton shimmer" style="height: 28px; width: 100%; border-radius: 8px;"></div>
              </div>
            </div>
          {/each}
        </div>
      </section>

      <div class="ov-top-grid">
        <section class="card ov-card ov-card-tight">
          <div class="ov-card-head">
            <div class="ov-skeleton shimmer" style="height: 13px; width: 140px;"></div>
          </div>
          <div class="ov-skeleton-list">
            {#each [1, 2, 3, 4] as _}
              <div class="ov-skeleton-row">
                <div class="ov-skeleton shimmer" style="height: 11px; width: 88px;"></div>
                <div class="ov-skeleton shimmer" style="height: 8px; width: 100%; border-radius: 999px;"></div>
                <div class="ov-skeleton shimmer" style="height: 11px; width: 30px;"></div>
              </div>
            {/each}
          </div>
        </section>

        <section class="card ov-card ov-card-tight">
          <div class="ov-card-head">
            <div class="ov-skeleton shimmer" style="height: 13px; width: 140px;"></div>
          </div>
          <div class="ov-skeleton-list">
            {#each [1, 2, 3] as _}
              <div class="ov-skeleton-deadline-row">
                <div class="ov-skeleton shimmer" style="width: 10px; height: 10px; border-radius: 999px;"></div>
                <div class="ov-skeleton-deadline-info">
                  <div class="ov-skeleton shimmer" style="height: 12px; width: 150px;"></div>
                  <div class="ov-skeleton shimmer" style="height: 11px; width: 110px;"></div>
                </div>
                <div class="ov-skeleton shimmer" style="height: 20px; width: 76px; border-radius: 999px;"></div>
              </div>
            {/each}
          </div>
        </section>
      </div>
    </div>
  {:else if activeView === 'Overview'}
    <section class="card ov-card">
      <div class="ov-card-head">
        <div class="ov-card-title">Tagged Projects</div>
        <button class="ov-view-all-btn" on:click={() => activeView = 'Projects'}>View all -&gt;</button>
      </div>
      {#if overviewSnippets.length === 0}
        <div class="ov-empty-state">
          <FolderOpen size={22} />
          <div class="ov-empty-title">No tagged projects yet</div>
          <div class="ov-empty-copy">
            Projects tagged to your supervisor account will appear here once interns add them.
          </div>
        </div>
      {:else}
        <div class="ov-snippets-grid">
            {#each pagedTaggedSnippets as p (p.id)}
              {@const sm = getStatusMeta(p.status)}
              {@const pl = normalizePriorityLabel(p.priority_level)}
              {@const pct = p.progress_percent != null ? Number(p.progress_percent) : statusToProgress(p.status)}
              {@const past = isDeadlinePast(p.timeline_end || p.deadline)}
              {@const near = !past && isDeadlineNear(p.timeline_end || p.deadline)}
              {@const ownerName = String(p.owner_name || resolveUserName(p.created_by) || '').trim() || 'Unassigned intern'}
              <div
                class="ov-snippet-card"
                role="button"
                tabindex="0"
                aria-label={`Open project ${p.title}`}
                on:click={() => viewProject(p)}
                on:keydown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    viewProject(p);
                  }
                }}
              >
                <div class="ov-snippet-top">
                  <div class="ov-snippet-headline">
                    <div class="ov-snippet-name">{p.title}</div>
                    <div class="ov-snippet-owner">
                      <Users2 size={12} /> {ownerName}
                    </div>
                  </div>
                  <div class="ov-snippet-top-right">
                    <span class={"proj-status-pill " + sm.cls}>{sm.label}</span>
                    <span class={"proj-priority-pill priority-" + pl.toLowerCase()}>{pl}</span>
                  </div>
                </div>
                <div class="ov-snippet-progress">
                  <div class="progress-bar-outer">
                    <div class="progress-bar-inner" style="width:{pct}%"></div>
                  </div>
                  <span class="ov-snippet-pct">{pct}%</span>
                </div>
                {#if p.timeline_end || p.deadline}
                  <div class="ov-snippet-meta-row">
                    <div class="ov-snippet-due" class:ov-date-past={past} class:ov-date-near={near}>
                      <CalendarDays size={11} />
                      <span>{past ? 'Past due' : near ? 'Due soon' : 'Due'}:</span>
                      <strong>{formatDate(p.timeline_end || p.deadline)}</strong>
                    </div>
                  </div>
                {/if}
                <div class="ov-snippet-actions">
                  {#if showArchiveProject(p)}
                    <button
                      class="sub-action-btn"
                      class:sub-action-btn-busy={archivingProjectIds.has(String(p.id || p.proj_id || '').trim())}
                      class:sub-action-btn-disabled={!canArchiveProject(p)}
                      title={archivingProjectIds.has(String(p.id || p.proj_id || '').trim()) ? 'Archiving...' : canArchiveProject(p) ? 'Archive project' : 'Archive available when project is completed'}
                      disabled={archivingProjectIds.has(String(p.id || p.proj_id || '').trim()) || !canArchiveProject(p)}
                      on:click|stopPropagation={() => archiveProject(p)}
                    >
                      {#if archivingProjectIds.has(String(p.id || p.proj_id || '').trim())}
                        <Loader2 size={12} class="spin" /> Archiving...
                      {:else}
                        <Archive size={12} /> Archive
                      {/if}
                    </button>
                  {/if}
                </div>
              </div>
          {/each}
        </div>
      {/if}
      {#if taggedProjectPageCount > 1}
        <div class="proj-page-footer">
          <div class="proj-page-nav">
            <button
              class="proj-page-btn"
              disabled={taggedProjectsPage === 0}
              on:click={() => taggedProjectsPage--}
              aria-label="Previous page"
            >&#8249;</button>
            <span class="proj-page-indicator">{taggedProjectsPage + 1} / {taggedProjectPageCount}</span>
            <button
              class="proj-page-btn"
              disabled={taggedProjectsPage >= taggedProjectPageCount - 1}
              on:click={() => taggedProjectsPage++}
              aria-label="Next page"
            >&#8250;</button>
          </div>
        </div>
      {/if}
    </section>

    <div class="ov-top-grid">
      <section class="card ov-card ov-card-tight">
        <div class="ov-card-head">
          <div class="ov-card-title">Project Completion Summary</div>
        </div>
        {#if workloadRows.length === 0}
          <div class="ov-empty">No intern project progress to summarize yet.</div>
        {:else}
          <div class="ov-status-bars ov-completion-bars">
            {#each workloadRows as row}
              <div class="ov-bar-row ov-completion-row">
                <div class="ov-bar-main">
                  <div class="ov-bar-label">{row.internName}</div>
                  <div class="ov-bar-meta">{row.completedCount} completed of {row.totalAssigned} assigned</div>
                </div>
                <div class="ov-bar-track ov-completion-track">
                  <div class="progress-bar-inner ov-completion-fill" style="width:{row.pct}%"></div>
                </div>
                <span class="ov-bar-count ov-completion-count">{row.pct}%</span>
              </div>
            {/each}
          </div>
        {/if}
      </section>

      <section class="card ov-card ov-card-tight">
        <div class="ov-card-head">
          <div class="ov-card-title">Upcoming Deadlines</div>
        </div>
        {#if upcomingDeadlines.length === 0}
          <div class="ov-empty">No upcoming deadlines.</div>
        {:else}
          <div class="ov-deadline-list">
            {#each upcomingDeadlines as p}
              {@const past = isDeadlinePast(p.timeline_end || p.deadline)}
              {@const near = !past && isDeadlineNear(p.timeline_end || p.deadline)}
              {@const sm = getStatusMeta(p.status)}
              <div class="ov-deadline-row">
                <div class="ov-deadline-icon" class:ov-deadline-icon-past={past} class:ov-deadline-icon-near={near && !past}>
                  <CalendarDays size={13} />
                </div>
                <div class="ov-deadline-body">
                  <div class="ov-deadline-name">{p.title}</div>
                  <div class="ov-deadline-date" class:ov-date-past={past} class:ov-date-near={near && !past}>
                    <CalendarDays size={11} /> {formatDate(p.timeline_end || p.deadline)}
                  </div>
                </div>
                <span class={"proj-status-pill " + sm.cls}>{sm.label}</span>
              </div>
            {/each}
          </div>
        {/if}
      </section>
    </div>
  {:else if activeView === 'Archive'}
    <section class="proj-table-panel archive-view">
      <header class="proj-table-header">
        <span class="proj-col-name">Archive</span>
        <span class="proj-col-actions">Actions</span>
      </header>
      {#if archivedProjects.length === 0}
        <div class="proj-table-body">
          <div class="empty-state">
            <Archive size={28} />
            <div class="empty-title">No archived projects</div>
            <div class="empty-sub">Archived projects will appear here.</div>
          </div>
        </div>
      {:else}
        <div class="proj-table-body">
          {#each archivedProjects as p (p.id)}
            {@const canRestore = canRestoreProject(p)}
            <div class="proj-table-row proj-arc-row">
              <span class="proj-col-name proj-name-cell">
                <div class="proj-arc-title">{p.title}</div>
              </span>
              <div class="proj-arc-corner">
                {#if canRestore}
                  <button
                    class="icon-btn restore"
                    class:icon-btn-busy={restoringProjectIds.has(String(p.id || p.proj_id || '').trim())}
                    title={restoringProjectIds.has(String(p.id || p.proj_id || '').trim()) ? 'Restoring...' : 'Restore project'}
                    aria-label={restoringProjectIds.has(String(p.id || p.proj_id || '').trim()) ? 'Restoring project' : 'Restore project'}
                    disabled={restoringProjectIds.has(String(p.id || p.proj_id || '').trim())}
                    on:click={() => restoreProject(p)}
                  >
                    {#if restoringProjectIds.has(String(p.id || p.proj_id || '').trim())}
                      <Loader2 size={16} class="spin" />
                    {:else}
                      <RotateCcw size={16} />
                    {/if}
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {:else if activeView === 'Projects'}
    <section class="proj-table-panel supervisor-projects-list">
      <header class="proj-table-header">
        <span class="proj-col-name">Project Name</span>
        <span class="proj-col-priority">Priority</span>
        <span class="proj-col-status">Status</span>
        <span class="proj-col-due">Timeline</span>
        <span class="proj-col-actions">Actions</span>
      </header>
      <div class="proj-table-body">
        {#if activeProjects.length === 0}
          <div class="proj-table-empty">
            <FolderOpen size={24} />
            <div class="empty-title">No tagged projects yet</div>
            <div class="empty-sub">
              Projects tagged to your supervisor account will appear here once interns add them.
            </div>
          </div>
        {:else if filteredProjects.length === 0}
          <div class="proj-table-empty">
            <FolderOpen size={20} />
            <div class="empty-title">No projects match the selected filters.</div>
            <div class="empty-sub">Try a different search, priority, or status.</div>
          </div>
        {:else}
          {#each filteredProjects as p (p.id)}
            {@const sm = getStatusMeta(p.status)}
            {@const past = isDeadlinePast(p.timeline_end || p.deadline)}
            {@const pl = normalizePriorityLabel(p.priority_level)}
            {@const isViewing = viewingProjectId === p.id}
            {@const canManage = canManageProject(p)}
            {@const canArchive = canArchiveProject(p)}
              <div
                class="proj-table-row"
                class:proj-row-active={isViewing}
                role="button"
                tabindex="0"
                aria-label={`Open project ${p.title}`}
                on:click={() => viewProject(p)}
                on:keydown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    viewProject(p);
                  }
                }}
              >
              <span class="proj-col-name proj-name-cell">{p.title}</span>
              <span class="proj-col-priority" data-label="Priority">
                <span class={"proj-priority-pill priority-" + pl.toLowerCase()}>{pl || ICONS.emDash}</span>
              </span>
              <span class="proj-col-status" data-label="Status">
                <span class={"proj-status-pill " + sm.cls}>{sm.label}</span>
              </span>
              <span class="proj-col-due proj-col-timeline" data-label="Timeline" class:deadline-past={past}>
                {p.timeline_start || p.timeline_end
                  ? (p.timeline_start && p.timeline_end
                      ? `${formatDate(p.timeline_start)} ${ICONS.emDash} ${formatDate(p.timeline_end)}`
                      : formatDate(p.timeline_start || p.timeline_end))
                  : (p.deadline ? formatDate(p.deadline) : ICONS.emDash)}
              </span>
              <span class="proj-col-actions proj-actions-cell" data-label="Actions">
                {#if showArchiveProject(p)}
                  <button
                    class="icon-btn archive"
                    class:icon-btn-busy={archivingProjectIds.has(String(p.id || p.proj_id || '').trim())}
                    class:icon-btn-disabled={!canArchiveProject(p)}
                    title={archivingProjectIds.has(String(p.id || p.proj_id || '').trim()) ? 'Archiving...' : canArchiveProject(p) ? 'Archive' : 'Archive available when project is completed'}
                    aria-label={archivingProjectIds.has(String(p.id || p.proj_id || '').trim()) ? 'Archiving project' : canArchiveProject(p) ? 'Archive project' : 'Archive unavailable until project is completed'}
                    disabled={archivingProjectIds.has(String(p.id || p.proj_id || '').trim()) || !canArchiveProject(p)}
                    on:click|stopPropagation={() => archiveProject(p)}
                  >
                    {#if archivingProjectIds.has(String(p.id || p.proj_id || '').trim())}
                      <Loader2 size={16} class="spin" />
                    {:else}
                      <Archive size={16} />
                    {/if}
                  </button>
                {/if}
              </span>
            </div>
          {/each}
        {/if}
      </div>
    </section>

    {#if filteredProjects.length > 0}
      <div class="projects-cards-mobile">
        {#each filteredProjects as p (p.id)}
          {@const pc = PRIORITY_COLORS[normalizePriorityLabel(p.priority_level)] || DEFAULT_PRIORITY_COLOR}
          {@const sm = getStatusMeta(p.status)}
          {@const past = isDeadlinePast(p.deadline)}
          {@const near = !past && isDeadlineNear(p.deadline)}
          {@const canManage = canManageProject(p)}
          {@const canArchive = canArchiveProject(p)}
          <div
            class="project-card"
            role="button"
            tabindex="0"
            aria-label={`Open project ${p.title}`}
            on:click={() => viewProject(p)}
            on:keydown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                viewProject(p);
              }
            }}
          >
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
              {#if showArchiveProject(p)}
                <button
                  class="sub-action-btn"
                  class:sub-action-btn-busy={archivingProjectIds.has(String(p.id || p.proj_id || '').trim())}
                  class:sub-action-btn-disabled={!canArchiveProject(p)}
                  disabled={archivingProjectIds.has(String(p.id || p.proj_id || '').trim()) || !canArchiveProject(p)}
                  on:click|stopPropagation={() => archiveProject(p)}
                >
                  {#if archivingProjectIds.has(String(p.id || p.proj_id || '').trim())}
                    <Loader2 size={12} class="spin" /> Archiving...
                  {:else}
                    <Archive size={12} /> Archive
                  {/if}
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</section>

{#if selectedViewingProject}
  {@const p = selectedViewingProject}
  {@const canManage = canManageProject(p)}
  <div
    class="modal-overlay proj-view-overlay"
    role="button"
    tabindex="0"
    aria-label="Close project details"
    on:click={closeProjectModal}
    on:keydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        closeProjectModal();
      }
    }}
  >
    <div
      class="proj-view-modal"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      on:click|stopPropagation
      on:keydown|stopPropagation={() => {}}
    >
      <div class="proj-view-head">
        <div>
          <div class="proj-view-kicker">Project Details</div>
          <div class="proj-view-title">{p.title}</div>
        </div>
        <button class="icon-btn proj-view-close" type="button" on:click={closeProjectModal} aria-label="Close project details">
          <X size={16} />
        </button>
      </div>

      <div class="proj-detail-tabs">
        <button class="proj-detail-tab-btn" class:active={viewingProjectTab === 'Details'} on:click={() => viewingProjectTab = 'Details'}>Details</button>
        <button class="proj-detail-tab-btn" class:active={viewingProjectTab === 'Submissions'} on:click={() => { viewingProjectTab = 'Submissions'; if (!p.folders) loadProjectFolders(p.id, { showSpinner: false }); }}>Submissions</button>
        <button class="proj-detail-tab-btn" class:active={viewingProjectTab === 'Feedback'} on:click={() => { viewingProjectTab = 'Feedback'; if (!(p.id in feedbackMap)) feedbackMap = { ...feedbackMap, [p.id]: [] }; void loadFeedback(p.id, { silent: true }); }}>Feedback</button>
      </div>

      <div class="proj-detail-body proj-view-body" class:feedback-scroll-transparent={viewingProjectTab === 'Feedback'}>
        {#if viewingProjectTab === 'Details'}
          {@const detailProgress = p.progress_percent != null ? p.progress_percent : statusToProgress(p.status)}
          {@const pl = getPriorityLabel(p.priority_level) || 'Low'}
          {@const detailMembers = buildProjectPersonList(p.members)}
          {@const detailSupervisors = buildProjectPersonList(p.supervisors)}
          <div class="proj-detail-read">
            <div class="pdr-layout">
              <div class="pdr-main">
                <div class="pdr-group">
                  <div class="pdr-label">Project Title</div>
                  <div class="pdr-box pdr-box-hero">{p.title || ICONS.emDash}</div>
                </div>

                <div class="pdr-group">
                  <div class="pdr-label">Description</div>
                  <div class="pdr-box pdr-box-desc">
                    <div class="detail-description" class:collapsed={p.description && p.description.length > 220 && expandedDescriptionId !== p.id}>{p.description || ICONS.emDash}</div>
                    {#if p.description && p.description.length > 220}
                      <div style="margin-top:6px">
                        <button class="btn-link" on:click={() => toggleDescription(p.id)}>{expandedDescriptionId === p.id ? 'Show less' : 'Show more'}</button>
                      </div>
                    {/if}
                  </div>
                </div>

                <div class="pdr-row-2">
                  <div class="pdr-group">
                    <div class="pdr-label">Priority Level</div>
                    <div class="pdr-box pdr-box-inline">
                      <span class="pdr-priority-dot priority-{pl.toLowerCase()}"></span>
                      <span>{pl}</span>
                    </div>
                  </div>
                  <div class="pdr-group">
                    <div class="pdr-label">Status</div>
                    <div class="pdr-box pdr-box-inline pdr-box-muted">{(STATUS_META[p.status] || {}).label || p.status || ICONS.emDash}</div>
                  </div>
                </div>

                <div class="pdr-row-2">
                  <div class="pdr-group">
                    <div class="pdr-label">Timeline Start</div>
                    <div class="pdr-box pdr-box-inline">
                      <CalendarDays size={14} class="pdr-inline-icon pdr-inline-icon-primary" />
                      <span>{p.timeline_start ? formatDate(p.timeline_start) : ICONS.emDash}</span>
                    </div>
                  </div>
                  <div class="pdr-group">
                    <div class="pdr-label">Timeline End</div>
                    <div class="pdr-box pdr-box-inline">
                      <CalendarDays size={14} class="pdr-inline-icon" />
                      <span>{p.timeline_end ? formatDate(p.timeline_end) : ICONS.emDash}</span>
                    </div>
                  </div>
                </div>

                <div class="pdr-group">
                  <div class="pdr-label">Progress</div>
                  <div class="pdr-progress-stack">
                    <div class="progress-bar-outer"><div class="progress-bar-inner" style="width:{detailProgress}%"></div></div>
                    <div class="pdr-progress-meta">
                      <span>{detailProgress} / 100%</span>
                      <span>{detailProgress}% complete</span>
                    </div>
                  </div>
                </div>

                {#if canManage}
                  <div class="pdr-footer">
                    <button class="pdr-edit-btn" on:click={() => openEditProjectModal(p)}>
                      <Pencil size={14} />
                      <span>Edit</span>
                    </button>
                  </div>
                {/if}
              </div>

              <aside class="pdr-sidebar">
                <div class="pdr-side-card">
                  <div class="pdr-side-title">
                    <Users2 size={13} />
                    <span>Members</span>
                  </div>
                  {#if detailMembers.length}
                    {#each detailMembers as member}
                      <div class="pdr-person-row">
                        <span class="pdr-avatar" aria-hidden="true">
                          {#if member.photoUrl}
                            <img src={member.photoUrl} alt="" />
                          {:else}
                            <span>{member.initials}</span>
                          {/if}
                        </span>
                        <span class="pdr-person-name">{member.label}</span>
                      </div>
                    {/each}
                  {:else}
                    <div class="pdr-empty-copy">No members assigned</div>
                  {/if}
                </div>

                <div class="pdr-side-card">
                  <div class="pdr-side-title">
                    <UserCheck size={13} />
                    <span>Supervisors</span>
                  </div>
                  {#if detailSupervisors.length}
                    {#each detailSupervisors as supervisor}
                      <div class="pdr-person-row">
                        <span class="pdr-avatar pdr-avatar-supervisor" aria-hidden="true">
                          {#if supervisor.photoUrl}
                            <img src={supervisor.photoUrl} alt="" />
                          {:else}
                            <span>{supervisor.initials}</span>
                          {/if}
                        </span>
                        <span class="pdr-person-name">{supervisor.label}</span>
                      </div>
                    {/each}
                  {:else}
                    <div class="pdr-empty-copy">No supervisors assigned</div>
                  {/if}
                </div>

                <div class="pdr-side-card">
                  <div class="pdr-side-title">
                    <Clock3 size={13} />
                    <span>Timeline</span>
                  </div>
                  <div class="pdr-mini-timeline">
                    <div class="pdr-mini-dot"></div>
                    <div class="pdr-mini-line"></div>
                    <div class="pdr-mini-dot pdr-mini-dot-end"></div>
                  </div>
                  <div class="pdr-mini-labels">
                    <span>{p.timeline_start ? formatShortMonthDay(p.timeline_start) : 'Start'}</span>
                    <span>{p.timeline_end ? formatShortMonthDay(p.timeline_end) : 'End'}</span>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        {:else if viewingProjectTab === 'Submissions'}
          {#if canManage}
            <div class="sub-action-bar">
              <button class="sub-action-btn" on:click={() => addFolder(p.id)}>
                <FolderOpen size={13} /> New Folder
              </button>
            </div>
          {/if}

          {#if p.folders === null}
            <div class="proj-detail-empty" style="padding:1rem 1.25rem; min-height:2.5rem;"></div>
          {:else if !p.folders || p.folders.length === 0}
            <div class="proj-detail-empty" style="padding:1rem 1.25rem">
              {canManage ? 'No folders yet. Click New Folder to get started.' : 'No folders yet.'}
            </div>
          {:else}
            <div class="folder-list">
              {#each p.folders as folder (folder.id)}
                <div class="folder-block">
                  <div class="folder-header" role="button" tabindex="0" on:click={() => { if (renamingFolderId !== folder.id) toggleFolder(folder.id); }} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleFolder(folder.id); }}>
                    <span class="folder-chevron">{expandedFolderIds.has(folder.id) ? ICONS.chevronDown : ICONS.chevronRight}</span>
                    <span class="folder-icon">{ICONS.folder}</span>
                    {#if canManage && renamingFolderId === folder.id}
                      <input class="folder-rename-input" bind:value={renamingFolderName} on:click|stopPropagation on:keydown={(e) => { if (e.key === 'Enter') confirmRename(p.id); if (e.key === 'Escape') { renamingFolderId = null; } }} />
                      <button class="folder-rename-confirm" on:click|stopPropagation={() => confirmRename(p.id)}>✓</button>
                    {:else}
                      <span class="folder-name">{folder.name}</span>
                      {#if canManage}
                        <button class="folder-action-btn" title="Rename" on:click|stopPropagation={() => startRenaming(folder.id, folder.name)}><Pencil size={12} /></button>
                        <button class="folder-action-btn folder-delete-btn" title="Delete folder" on:click|stopPropagation={() => deleteFolder(p.id, folder.id)}><Trash2 size={12} /></button>
                      {/if}
                    {/if}
                  </div>
                  {#if expandedFolderIds.has(folder.id)}
                    <div class="folder-content">
                      {#if canManage}
                        <div class="sub-action-bar sub-action-bar-inline">
                          <input id={"proj-file-input-" + p.id + "-" + folder.id} type="file" on:change={(e) => handleFileSelect(p.id, folder.id, e)} style="display:none" />
                          <button class="sub-action-btn" on:click={() => triggerFilePicker(p.id, folder.id)}>
                            <ExternalLink size={13} /> Upload File
                          </button>
                          <button class="sub-action-btn" class:sub-action-btn-active={activeLinkFolderId === folder.id} on:click={() => toggleLinkPanel(folder.id)}>
                            <Link2 size={13} /> Add Link
                          </button>
                        </div>
                      {/if}
                      {#if activeLinkFolderId === folder.id}
                        <div class="add-link-form">
                          <input class="sub-input" placeholder="Label  e.g. GitHub Repository" bind:value={viewingLinkLabel} />
                          <input class="sub-input" placeholder="https://example.com" bind:value={viewingLinkUrl} />
                          <div class="add-link-actions">
                            <button class="sub-action-btn" class:sub-action-btn-busy={isSavingLink} disabled={isSavingLink} on:click={() => addLinkSubmission(p.id, folder.id)}>
                              {#if isSavingLink}<Loader2 size={13} class="spin" /> Saving...{:else}Save Link{/if}
                            </button>
                            <button class="sub-cancel-btn" disabled={isSavingLink} on:click={() => toggleLinkPanel(folder.id)}>Cancel</button>
                          </div>
                          {#if formError}<div class="sub-error">{formError}</div>{/if}
                        </div>
                      {/if}
                      {#if pendingUpload.projectId === p.id && pendingUpload.folderId === folder.id && pendingUpload.file}
                        <div class="submission-card pending-upload" style="margin:0.5rem 0.75rem;">
                          <div class="submission-card-left">
                            <div class="sub-file-icon">{ICONS.file}</div>
                            <div class="submission-meta">
                              <input class="sub-input" bind:value={pendingUpload.name} placeholder="File name" />
                              <div class="submission-info">Selected: {pendingUpload.file ? pendingUpload.file.name : ''} ({pendingUpload.file ? (pendingUpload.file.size / (1024*1024)).toFixed(2) + ' MB' : ''})</div>
                            </div>
                          </div>
                          <div class="submission-actions">
                            <button class="sub-action-btn" disabled={isUploadingFile} on:click={() => confirmUpload(p.id, folder.id)}>
                              {#if isUploadingFile}<Loader2 size={13} class="spin" /> Uploading...{:else}Upload{/if}
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
                                  <div class="sub-file-icon">{ICONS.file}</div>
                                  <div class="submission-meta">
                                    <div class="submission-name">{s.name}</div>
                                    <div class="submission-info">Uploaded: {s.uploaded_at ? formatDate(s.uploaded_at) : ''}</div>
                                  </div>
                                </div>
                                <div class="submission-actions">
                                  <button class="icon-btn" title="View in Drive" on:click={() => viewSubmission(s)}><Eye size={14} /></button>
                                  <button class="icon-btn" title="Open in Drive" on:click={() => downloadSubmission(s)}><Download size={14} /></button>
                                  {#if canManage}
                                    <button class="icon-btn" title="Delete attachment" on:click={() => deleteSubmission(p.id, folder.id, s.id)}><Trash2 size={14} /></button>
                                  {/if}
                                </div>
                              </div>
                            {:else}
                              <div class="submission-card link-card">
                                <div class="link-card-body">
                                  <div class="link-card-title">{ICONS.link} {s.title}</div>
                                  <div class="link-card-url">{s.url}</div>
                                  <div class="submission-info">Added: {s.added_at ? formatDate(s.added_at) : ''}</div>
                                </div>
                                <div class="submission-actions">
                                  <button class="sub-open-btn" on:click={() => viewSubmission(s)}>Open Link</button>
                                  {#if canManage}
                                    <button class="icon-btn" title="Delete link" on:click={() => deleteSubmission(p.id, folder.id, s.id)}><Trash2 size={14} /></button>
                                  {/if}
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
        {:else if viewingProjectTab === 'Feedback'}
          <div class="feedback-wrap">
            {#each (feedbackMap[p.id] || []).filter(f => !f.parent_id) as thread (feedbackIdOf(thread))}
              <FeedbackThread
                item={thread}
                projectId={p.id}
                depth={0}
                {replyingTo}
                {replyText}
                {replySubmitting}
                {currentUser}
                {getCurrentUser}
                getChildren={feedbackChildren}
                resolveUserName={resolveUserName}
                onToggleReply={toggleReply}
                onReplyText={updateReplyText}
                onSubmitReply={submitReply}
                onCancelReply={cancelReply}
                onDelete={deleteFeedback}
              />
            {/each}
            {#if !(feedbackMap[p.id] || []).filter(f => !f.parent_id).length}
              <div class="proj-detail-empty">No feedback yet. Be the first to comment.</div>
            {/if}
            <div class="fb-new-comment">
              <textarea class="fb-reply-input" rows="3" placeholder="Add a comment..." value={newFeedbackText[p.id] || ''} on:input={(e) => { newFeedbackText = { ...newFeedbackText, [p.id]: e.currentTarget.value }; }}></textarea>
              <button class="sub-action-btn fb-post-btn" class:sub-action-btn-busy={!!postingFeedback[p.id]} disabled={!!postingFeedback[p.id]} on:click={() => submitFeedback(p.id)} aria-label="Post comment">
                {#if postingFeedback[p.id]}
                  <Loader2 size={14} class="spin" />
                  <span>Posting...</span>
                {:else}
                  <Send size={14} />
                  <span>Post Comment</span>
                {/if}
              </button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if showAddProjectModal}
  <div class="modal-overlay">
    <div class="modal-box large" on:click|stopPropagation>
      <div class="modal-title">{editingProjectId ? 'Edit Project' : 'Add New Project'}</div>
      <div class="modal-content">
        {#if projectFormError}
          <div class="form-alert error">{projectFormError}</div>
        {/if}

        <div class="form-group">
          <label class="form-label" for="sup-proj-title">Project Title <span class="req">*</span></label>
          <input
            id="sup-proj-title"
            type="text"
            class="form-input"
            bind:value={projectForm.title}
            placeholder="e.g. IMS Portal Enhancements"
            maxlength="120"
          />
        </div>

        <div class="form-group">
          <label class="form-label" for="sup-proj-desc">Description</label>
          <textarea
            id="sup-proj-desc"
            class="form-textarea"
            bind:value={projectForm.description}
            rows="3"
            placeholder="Brief description of the project..."
            maxlength="500"
          ></textarea>
        </div>

        <div class="form-group">
          <div class="form-label">Members</div>
          <div class="members-select" bind:this={membersSelectEl}>
            <div class="members-input form-input" on:click={toggleMembersDropdown} role="button" tabindex="0" aria-expanded={showMembersPanel}>
              <div class="members-value">
                {#if (projectForm.members || []).length === 0}
                  <span class="members-placeholder">Select members</span>
                {:else}
                  <div class="members-chips">
                    {#each memberChipList as member (member.value)}
                      <span class="member-chip" title={member.label}>{member.label}</span>
                    {/each}
                  </div>
                {/if}
              </div>
              <div class="muted">{(projectForm.members || []).length}</div>
            </div>
            {#if showMembersPanel}
              <div class="members-panel members-panel-dropdown">
                <div class="members-search">
                  <input class="members-search-input" type="text" placeholder="Search interns..." bind:value={memberSearch} />
                </div>
                <div class="members-list">
                  {#if usersLoading}
                    <span class="members-empty">{assignmentEmptyMessage('intern')}</span>
                  {:else if filteredMemberOptions.length}
                    {#each filteredMemberOptions as member}
                      <label class="members-item">
                        <input type="checkbox" checked={(projectForm.members || []).includes(member.value)} on:change={() => toggleMember(member.value)} />
                        <span class="member-avatar" aria-hidden="true">
                          {#if member.photoUrl}
                            <img src={member.photoUrl} alt="" />
                          {:else}
                            <span>{member.initials}</span>
                          {/if}
                        </span>
                        <span class="members-name">{member.label}</span>
                      </label>
                    {/each}
                  {:else}
                    <span class="members-empty">{memberSearch ? 'No matches found.' : assignmentEmptyMessage('intern')}</span>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
        </div>

        <div class="form-group">
          <div class="form-label">Supervisor</div>
          <div class="members-select" bind:this={supervisorsSelectEl}>
            <div class="members-input form-input" on:click={toggleSupervisorsDropdown} role="button" tabindex="0" aria-expanded={showSupervisorsPanel}>
              <div class="members-value">
                {#if (projectForm.supervisor || []).length === 0}
                  <span class="members-placeholder">Select supervisor(s)</span>
                {:else if (projectForm.supervisor || []).length <= MAX_ASSIGNMENT_CHIPS}
                  <div class="members-chips">
                    {#each supervisorChipList as supervisor (supervisor.value)}
                      <span class="member-chip" title={supervisor.label}>{supervisor.label}</span>
                    {/each}
                  </div>
                {:else}
                  <span class="members-count-text">{(projectForm.supervisor || []).length} supervisors selected</span>
                {/if}
              </div>
              <div class="muted">{(projectForm.supervisor || []).length}</div>
            </div>
            {#if showSupervisorsPanel}
              <div class="members-panel members-panel-dropdown">
                <div class="members-search">
                  <input class="members-search-input" type="text" placeholder="Search supervisors..." bind:value={supervisorSearch} />
                </div>
                <div class="members-list">
                  {#if usersLoading}
                    <span class="members-empty">{assignmentEmptyMessage('supervisor')}</span>
                  {:else if filteredSupervisorOptions.length}
                    {#each filteredSupervisorOptions as supervisor}
                      {@const isCreatorSupervisor = String(supervisor.value || '').trim() === String(getCurrentUserId() || '').trim()}
                      <label class="members-item">
                        <input
                          type="checkbox"
                          checked={(projectForm.supervisor || []).includes(supervisor.value)}
                          disabled={isCreatorSupervisor}
                          on:change={() => toggleSupervisor(supervisor.value)}
                        />
                        <span class="member-avatar" aria-hidden="true">
                          {#if supervisor.photoUrl}
                            <img src={supervisor.photoUrl} alt="" />
                          {:else}
                            <span>{supervisor.initials}</span>
                          {/if}
                        </span>
                        <span class="members-name">
                          {supervisor.label}
                          {#if isCreatorSupervisor}
                            <span class="members-lock-hint">(Creator)</span>
                          {/if}
                        </span>
                      </label>
                    {/each}
                  {:else}
                    <span class="members-empty">{supervisorSearch ? 'No matches found.' : assignmentEmptyMessage('supervisor')}</span>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
        </div>

        <div class="row-2">
          <div class="form-group">
            <label class="form-label" for="sup-proj-priority">Priority</label>
            <select id="sup-proj-priority" class="form-input" bind:value={projectForm.priority_level}>
              {#each PRIORITY_OPTIONS as priority}
                <option value={priority}>{priority}</option>
              {/each}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label" for="sup-proj-status">Status</label>
            <select id="sup-proj-status" class="form-input" bind:value={projectForm.status}>
              {#each STATUS_OPTIONS as status}
                <option value={status}>{status}</option>
              {/each}
            </select>
          </div>
        </div>

        <div class="row-2">
          <div class="form-group">
            <label class="form-label" for="sup-proj-start">Timeline Start <span class="req">*</span></label>
            <input
              id="sup-proj-start"
              type="date"
              class="form-input"
              bind:value={projectForm.timeline_start}
              max={projectForm.timeline_end || undefined}
            />
          </div>

          <div class="form-group">
            <label class="form-label" for="sup-proj-end">Timeline End <span class="req">*</span></label>
            <input
              id="sup-proj-end"
              type="date"
              class="form-input"
              bind:value={projectForm.timeline_end}
              min={projectForm.timeline_start || undefined}
            />
          </div>
        </div>
      </div>

      <div class="modal-footer modal-footer-sticky">
        <button class="btn-secondary" on:click={closeAddProjectModal} disabled={isSubmittingProject}>Cancel</button>
        <button class="btn-submit" on:click={submitProject} disabled={isSubmittingProject || !isProjectFormValid}>
          {#if isSubmittingProject}
            <Loader2 size={14} class="spin" /> Saving...
          {:else}
            {editingProjectId ? 'Save Changes' : 'Add Project'}
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showDeleteProjectModal}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="modal-overlay" on:click={closeDeleteProjectModal}>
    <div class="modal-box" on:click|stopPropagation>
      <div class="modal-title">Delete Project</div>
      <p class="modal-body">
        Are you sure you want to delete <strong>{projectToDelete?.title}</strong>? This cannot be undone.
      </p>
      <div class="modal-footer">
        <button class="btn-secondary" on:click={closeDeleteProjectModal}>Cancel</button>
        <button class="btn-delete-confirm" on:click={confirmDeleteProject} disabled={isDeletingProject}>
          {isDeletingProject ? 'Deleting...' : 'Delete'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .projects-page { padding: 8px 0 14px; display: flex; flex-direction: column; gap: 14px; }

  .stat-cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-top: 0; }
  .stat-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03);
    padding: 18px 20px;
    display: flex;
    align-items: flex-start;
    gap: 14px;
    transition: box-shadow 0.2s, transform 0.2s;
  }
  .stat-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1); }
  .stat-icon { width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; flex-shrink: 0; }
  .stat-body { display: flex; flex-direction: column; gap: 4px; }
  .stat-card-skeleton {
    pointer-events: none;
    transform: none !important;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03);
  }
  .stat-icon-skeleton { background: transparent; }
  .stat-body-skeleton { width: 100%; gap: 7px; }
  .stat-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: #000000; }
  .stat-value { font-size: 24px; font-weight: 700; letter-spacing: -0.8px; line-height: 1; color: #0f172a; }
  .stat-sub { margin-top: 4px; font-size: 11.5px; color: #64748b; }
  .tone-blue { background: rgba(37, 99, 235, 0.12); color: #2563eb; }
  .tone-amber { background: rgba(217, 119, 6, 0.12); color: #d97706; }
  .tone-green { background: rgba(22, 163, 74, 0.12); color: #16a34a; }
  .tone-violet { background: rgba(124, 58, 237, 0.14); color: #7c3aed; }

  .quick-panel { background: transparent !important; padding: 0; border-radius: 0; border: none !important; box-shadow: none !important; display: flex; align-items: center; justify-content: space-between; position: relative; isolation: isolate; }
  .quick-head { display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 0.75rem; flex-wrap: nowrap; position: relative; z-index: 2; }
  .view-controls { display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap; position: relative; z-index: 3; }
  .view-controls .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    border-radius: 0.7rem;
    padding: 0.32rem 0.72rem;
    background: transparent;
    border: 1px solid var(--color-border);
    font-size: 0.84rem;
    height: 2.15rem;
    line-height: 1;
    color: var(--color-sidebar-text);
    cursor: pointer;
    position: relative;
    z-index: 4;
  }
  .view-controls .btn.active { background: var(--color-soft); color: var(--color-heading); border-color: var(--color-border); }
  .quick-actions { display: flex; gap: 0.5rem; align-items: center; margin-left: auto; flex-wrap: nowrap; }
  .search-wrap { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0 0.7rem; color: var(--color-muted); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 0.7rem; height: 2.15rem; }
  .search-input { border: 0; background: transparent; color: var(--color-text); font-size: 0.85rem; width: 11.5rem; outline: none; padding: 0; height: 100%; }
  .quick-actions select, .quick-status, .quick-priority {
    padding: 0 0.6rem;
    border-radius: 0.7rem;
    font-size: 0.85rem;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    height: 2.15rem;
  }
  .quick-actions .primary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    padding: 0 0.95rem;
    border-radius: 0.7rem;
    font-size: 0.85rem;
    font-weight: 600;
    border: none;
    background: #2563eb;
    color: #ffffff;
    height: 2.15rem;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s ease, transform 0.15s ease;
  }
  .quick-actions .primary:hover { background: #1d4ed8; transform: translateY(-1px); }

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

  .icon-btn {
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
  .icon-btn-busy {
    border-color: var(--color-accent) !important;
    background: color-mix(in srgb, var(--color-accent) 12%, var(--color-surface)) !important;
  }
  .icon-btn.archive {
    background: transparent;
    border-color: rgba(255,255,255,0.06);
    color: var(--color-accent);
  }
  .icon-btn.archive.icon-btn-disabled {
    color: var(--color-sidebar-text);
    border-color: var(--color-border);
    background: transparent;
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
  .retry-btn:hover { background: #1d4ed8; }
  .sub-action-btn-disabled {
    background: var(--color-surface) !important;
    border-color: var(--color-border) !important;
    color: var(--color-sidebar-text) !important;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    padding: 28px 20px 24px;
    min-height: 210px;
    color: var(--color-sidebar-text);
    text-align: center;
  }
  .empty-title { font-size: 14px; font-weight: 600; color: var(--color-text); }
  .empty-sub { font-size: 12.5px; }
  .loading-shell { display: flex; flex-direction: column; gap: 10px; }
  .loading-shell .ov-card { min-height: 0; }

  .ov-skeleton {
    position: relative;
    overflow: hidden;
    background: rgba(15, 23, 42, 0.09);
    border-radius: 6px;
  }
  :global(body.dark) .ov-skeleton { background: rgba(255, 255, 255, 0.08); }
  .shimmer::after {
    content: '';
    position: absolute;
    inset: 0;
    transform: translateX(-100%);
    background-image: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0) 0,
      rgba(255, 255, 255, 0.35) 25%,
      rgba(255, 255, 255, 0.65) 60%,
      rgba(255, 255, 255, 0) 100%
    );
    animation: ovShimmer 1.4s infinite;
  }
  :global(body.dark) .shimmer::after {
    background-image: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0) 0,
      rgba(255, 255, 255, 0.06) 25%,
      rgba(255, 255, 255, 0.16) 60%,
      rgba(255, 255, 255, 0) 100%
    );
  }
  @keyframes ovShimmer { 100% { transform: translateX(100%); } }

  .ov-top-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    align-items: stretch;
  }
  .ov-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 0.9rem;
    padding: 1rem 1.15rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    height: 100%;
    box-sizing: border-box;
  }
  .ov-card-tight {
    padding: 0.9rem 1rem;
    gap: 0.55rem;
    height: clamp(15rem, 24vh, 17rem);
    overflow: hidden;
  }
  .ov-bottom-grid { display: grid; grid-template-columns: 1fr; gap: 0.8rem; align-items: start; }
  .ov-card-head { display: flex; align-items: center; justify-content: space-between; padding: 0.6rem 1rem; }
  .ov-card-title { font-size: 0.85rem; font-weight: 700; color: var(--color-heading); letter-spacing: -0.01em; }
  .ov-view-all-btn { background: transparent; border: 0; color: #2563eb; font-size: 0.82rem; font-weight: 600; cursor: pointer; }
  .ov-refresh-btn {
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 0.2rem 0.55rem;
    color: var(--color-sidebar-text);
    cursor: pointer;
    line-height: 1.2;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .ov-empty { font-size: 0.83rem; color: var(--color-sidebar-text); padding: 0.25rem 0.1rem; }
  .ov-empty-state {
    min-height: 12.5rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    padding: 1rem;
    text-align: center;
    color: var(--color-sidebar-text);
  }
  .ov-empty-title {
    font-size: 0.92rem;
    font-weight: 700;
    color: var(--color-heading);
  }
  .ov-empty-copy {
    max-width: 30rem;
    font-size: 0.82rem;
    line-height: 1.5;
  }

  .ov-status-bars {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    padding-right: 0.2rem;
    scrollbar-gutter: stable;
  }
  .ov-skeleton-list { display: flex; flex-direction: column; gap: 0.6rem; }
  .ov-skeleton-row {
    display: grid;
    grid-template-columns: 7.5rem 1fr 2.2rem;
    gap: 0.65rem;
    align-items: center;
  }
  .ov-skeleton-deadline-row { display: flex; align-items: center; gap: 0.65rem; }
  .ov-skeleton-deadline-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ov-bar-row { display: grid; grid-template-columns: minmax(0, 1fr) 13rem 3rem; align-items: center; gap: 0.85rem; }
  .ov-bar-main { min-width: 0; display: flex; flex-direction: column; gap: 0.18rem; }
  .ov-bar-label {
    font-size: 0.83rem;
    color: var(--color-heading);
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ov-bar-meta {
    font-size: 0.74rem;
    color: var(--color-sidebar-text);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ov-bar-track { height: 8px; background: rgba(148, 163, 184, 0.2); border-radius: 999px; overflow: hidden; }
  .ov-bar-count { font-size: 0.78rem; color: var(--color-heading); text-align: right; white-space: nowrap; font-weight: 700; }
  .ov-ms-done { font-weight: 700; color: var(--color-heading); }
  .ov-completion-bars { gap: 0.95rem; }
  .ov-completion-row {
    padding: 0.8rem 0.85rem;
    border-radius: 0.95rem;
    border: 1px solid rgba(148, 163, 184, 0.14);
    background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.015));
  }
  .ov-completion-track {
    height: 10px;
    background: rgba(71, 85, 105, 0.45);
    box-shadow: inset 0 1px 1px rgba(15, 23, 42, 0.28);
  }
  .ov-completion-fill {
    background: linear-gradient(90deg, #34d399 0%, #60a5fa 100%);
    box-shadow: 0 0 18px rgba(96, 165, 250, 0.18);
  }
  .ov-completion-count { color: #dbe7ff; }
  :global(body.dark) .ov-bar-meta { color: #8da2c0; }
  :global(body.dark) .ov-completion-row {
    background: linear-gradient(180deg, rgba(30, 41, 59, 0.38), rgba(15, 23, 42, 0.24));
    border-color: rgba(148, 163, 184, 0.12);
  }
  :global(body.dark) .ov-completion-count { color: #f8fafc; }
  @media (max-width: 900px) {
    .ov-bar-row { grid-template-columns: 1fr; gap: 0.55rem; }
    .ov-bar-count { text-align: left; }
  }
  .ov-archived-note { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.75rem; color: var(--color-sidebar-text); }

  .ov-deadline-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    padding-right: 0.2rem;
    scrollbar-gutter: stable;
  }
  .ov-deadline-row {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--color-border);
  }
  .ov-deadline-row:last-child { border-bottom: none; }
  .ov-deadline-icon {
    width: 28px;
    height: 28px;
    border-radius: 7px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    color: var(--color-sidebar-text);
    background: rgba(37, 99, 235, 0.08);
  }
  .ov-deadline-icon-near { background: rgba(251, 191, 36, 0.12); color: #f59e0b; }
  .ov-deadline-icon-past { background: rgba(239, 68, 68, 0.12); color: #ef4444; }
  .ov-deadline-body { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 4px; }
  .ov-deadline-name {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--color-heading);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ov-deadline-date { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.74rem; color: var(--color-sidebar-text); }
  .ov-date-past { color: #dc2626; }
  .ov-date-near { color: #d97706; }

  .ov-snippets-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.8rem; }
  .ov-snippet-card {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding: 1.1rem 1.2rem;
    border: 1px solid var(--color-border);
    border-radius: 1rem;
    background:
      radial-gradient(circle at top right, rgba(59, 130, 246, 0.07), transparent 42%),
      linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.015)),
      var(--color-soft);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
    transition: border-color 140ms, box-shadow 140ms, transform 140ms;
  }
  .ov-snippet-card:hover { border-color: var(--color-accent); box-shadow: 0 16px 28px -24px rgba(15,23,42,.38); transform: translateY(-1px); }
  .ov-snippet-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; }
  .ov-snippet-headline { min-width: 0; display: flex; flex-direction: column; gap: 0.38rem; }
  .ov-snippet-name { font-size: 0.88rem; font-weight: 700; color: var(--color-heading); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ov-snippet-owner {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--color-sidebar-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ov-snippet-top-right { display: flex; align-items: center; gap: 0.5rem; }
  .ov-snippet-progress { display: flex; align-items: center; gap: 0.55rem; }
  .ov-snippet-progress .progress-bar-outer { flex: 1; }
  .ov-snippet-pct { font-size: 0.78rem; font-weight: 700; color: var(--color-heading); white-space: nowrap; width: 32px; text-align: right; }
  .ov-snippet-meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
  }
  .ov-snippet-due {
    font-size: 0.77rem;
    color: var(--color-sidebar-text);
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ov-snippet-due strong { color: var(--color-heading); font-weight: 700; }
  .ov-snippet-date-chip {
    flex: 0 0 auto;
    padding: 0.28rem 0.55rem;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 700;
    color: #c7d8f8;
    background: rgba(59, 130, 246, 0.12);
    border: 1px solid rgba(96, 165, 250, 0.18);
  }
  .ov-snippet-date-chip-near { color: #fbbf24; background: rgba(245, 158, 11, 0.12); border-color: rgba(245, 158, 11, 0.2); }
  .ov-snippet-date-chip-past { color: #fca5a5; background: rgba(239, 68, 68, 0.12); border-color: rgba(239, 68, 68, 0.2); }
  .ov-snippet-actions { display: flex; gap: 0.4rem; margin-top: auto; padding-top: 0.05rem; }
  .ov-snippet-actions .sub-action-btn {
    flex: 1;
    justify-content: center;
    font-size: 0.78rem;
    padding: 0.38rem 0.7rem;
  }
  .proj-page-nav {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .proj-page-footer {
    margin-top: 0.65rem;
    display: flex;
    justify-content: flex-end;
  }
  .proj-page-btn {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-heading);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    cursor: pointer;
    transition: background 120ms, border-color 120ms;
    padding: 0;
  }
  .proj-page-btn:hover:not(:disabled) {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: #fff;
  }
  .proj-page-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  :global(body.dark) .proj-page-btn { background: #161c27; border-color: #ffffff10; }
  .proj-page-indicator {
    font-size: 0.78rem;
    color: var(--color-sidebar-text);
    white-space: nowrap;
  }

  .project-meta { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .meta-item { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--color-sidebar-text); }
  .team-chip { color: #2563eb; font-weight: 500; }
  .intern-chip { color: #2563eb; font-weight: 500; }

  .progress-bar-outer { height: 10px; background: var(--color-border); border-radius: 999px; overflow: hidden; }
  .progress-bar-inner { height: 100%; background: linear-gradient(90deg, #10b981, #3b82f6); border-radius: 999px; transition: width 350ms ease; }

  .proj-status-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.22rem 0.6rem;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--color-text);
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.04);
    white-space: nowrap;
  }
  .proj-status-pill.status-not-started { background: rgba(249,115,22,0.08); color: #f38f49; border-color: rgba(249,115,22,0.12); }
  .proj-status-pill.status-in-progress { background: rgba(16,185,129,0.08); color: #10b981; border-color: rgba(16,185,129,0.12); }
  .proj-status-pill.status-submitted { background: rgba(124,58,237,0.08); color: #7c3aed; border-color: rgba(124,58,237,0.12); }
  .proj-status-pill.status-needs-revision { background: rgba(239,68,68,0.08); color: #ef4444; border-color: rgba(239,68,68,0.12); }
  .proj-status-pill.status-approved { background: rgba(59,130,246,0.08); color: #3b82f6; border-color: rgba(59,130,246,0.12); }
  .proj-status-pill.status-pending { background: rgba(251,146,60,0.10); color: #ea7a1e; border-color: rgba(251,146,60,0.18); }

  .proj-priority-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.22rem 0.6rem;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--color-text);
    background: rgba(99,102,241,0.06);
    border: 1px solid rgba(99,102,241,0.12);
    white-space: nowrap;
  }
  .proj-priority-pill.priority-low { background: rgba(56,189,248,0.08); color: #38bdf8; border-color: rgba(56,189,248,0.12); }
  .proj-priority-pill.priority-medium { background: rgba(16,185,129,0.08); color: #10b981; border-color: rgba(16,185,129,0.12); }
  .proj-priority-pill.priority-high { background: rgba(239,68,68,0.08); color: #ef4444; border-color: rgba(239,68,68,0.12); }

  .priority-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: fit-content;
    padding: 3px 8px;
    border-radius: 999px;
    border: 1px solid;
    font-size: 10.5px;
    font-weight: 700;
    line-height: 1.2;
    white-space: nowrap;
  }
  :global(body.dark) .priority-badge { filter: brightness(.9) saturate(.95); }

  .sub-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
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

  .proj-table-panel {
    overflow: hidden;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 0.9rem;
  }
  .proj-table-header {
    display: grid;
    grid-template-columns: minmax(0,1fr) 3.5rem;
    align-items: center;
    gap: 0.9rem;
    padding: 0.85rem 1rem;
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
    color: var(--color-heading);
    font-size: 0.77rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }
  .proj-table-header > .proj-col-actions { justify-self: end; }
  .proj-table-body { display: grid; background: var(--color-soft); padding: 0.4rem; gap: 0.4rem; }
  .proj-table-empty {
    min-height: 13rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    padding: 1.4rem 1rem;
    border: 1px dashed var(--color-border);
    border-radius: 0.65rem;
    background: var(--color-surface);
    text-align: center;
    color: var(--color-sidebar-text);
  }
  .proj-table-row {
    display: grid;
    grid-template-columns: minmax(0,1fr) 3.5rem;
    align-items: center;
    gap: 0.9rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--color-border);
    border-radius: 0.65rem;
    background: var(--color-surface);
    transition: border-color 140ms ease, box-shadow 140ms ease;
  }
  .proj-table-row:hover { border-color: var(--color-accent); box-shadow: 0 8px 22px -20px rgba(15,23,42,.35); }
  .proj-name-cell { font-size: 0.88rem; font-weight: 600; color: var(--color-heading); }
  .supervisor-projects-list .proj-table-header,
  .supervisor-projects-list .proj-table-row {
    grid-template-columns: minmax(0,1fr) 7.5rem 7.5rem 12rem 6.5rem;
  }
  .supervisor-projects-list .proj-col-priority,
  .supervisor-projects-list .proj-col-status,
  .supervisor-projects-list .proj-col-due,
  .supervisor-projects-list .proj-col-actions {
    justify-self: center;
    text-align: center;
    color: #6f86af;
  }
  .supervisor-projects-list .proj-table-header > .proj-col-name { color: #6f86af; }
  .supervisor-projects-list .proj-name-cell { color: #e5edf8; }
  .archive-view .proj-table-header > .proj-col-name,
  .archive-view .proj-table-header > .proj-col-actions {
    color: #6f86af;
  }
  .proj-col-timeline {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 220px;
    font-size: 0.83rem;
    color: var(--color-sidebar-text);
  }
  .proj-actions-cell {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.55rem;
  }
  .supervisor-projects-list .icon-btn {
    width: 36px;
    height: 36px;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    background: var(--color-surface-muted);
    color: var(--color-sidebar-text);
    margin: 0;
  }
  .supervisor-projects-list .icon-btn:hover,
  .supervisor-projects-list .icon-btn-active {
    background: rgba(59,130,246,0.12) !important;
    border-color: #3b82f6 !important;
    color: #3b82f6 !important;
  }
  .proj-arc-title { font-size: 0.88rem; font-weight: 600; color: var(--color-heading); }
  .archive-view .proj-arc-title { color: #e5edf8; }
  .proj-arc-meta { display: flex; align-items: center; gap: 0.4rem; margin-top: 0.35rem; color: var(--color-sidebar-text); font-size: 0.77rem; }
  .proj-arc-date { font-weight: 700; color: var(--color-heading); }
  .proj-arc-corner { display: flex; justify-content: flex-end; }

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
  .sub-action-btn-busy {
    opacity: 0.72;
    pointer-events: none;
  }
  .sub-action-btn-active {
    background: rgba(59,130,246,0.1) !important;
    border-color: #3b82f6 !important;
    color: #3b82f6 !important;
  }
  .sub-action-btn:hover { background: var(--color-soft); border-color: var(--color-accent); }
  :global(body.dark) .sub-action-btn { background: #161c27; border-color: #ffffff10; }

  .projects-cards-mobile { display: none; grid-template-columns: 1fr; gap: 12px; }
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
    width: 36px;
    height: 36px;
    border-radius: 8px;
    padding: 6px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    color: var(--color-accent);
    cursor: pointer;
    transition: transform 0.12s, background 0.12s, border-color 0.12s;
  }
  .icon-btn:hover { background: color-mix(in srgb, var(--color-accent) 12%, var(--color-surface)); border-color: var(--color-accent); transform: translateY(-1px); }
  .icon-btn.restore { background: transparent; border-color: rgba(255,255,255,0.06); color: #10b981; }
  .icon-btn.restore:hover { background: rgba(16,185,129,0.1); border-color: #10b981; }

  .proj-arc-title { font-size: 0.88rem; font-weight: 600; color: var(--color-heading); }
  .proj-arc-corner { display: flex; justify-content: flex-end; }

  :global(.spin) { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  :global(body.dark) .stat-card { background: #161c27; border-color: rgba(255, 255, 255, 0.06); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18); }
  :global(body.dark) .stat-card:hover { box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35); }
  :global(body.dark) .stat-label { color: #ffffff; }
  :global(body.dark) .stat-value { color: #f1f5f9; }
  :global(body.dark) .stat-sub { color: #94a3b8; }
  :global(body.dark) .tone-blue { background: rgba(59, 130, 246, 0.18); color: #60a5fa; }
  :global(body.dark) .tone-amber { background: rgba(245, 158, 11, 0.12); color: #f59e0b; }
  :global(body.dark) .tone-green { background: rgba(34, 197, 94, 0.14); color: #22c55e; }
  :global(body.dark) .tone-violet { background: rgba(124, 58, 237, 0.2); color: #a78bfa; }
  :global(body.dark) .search-wrap { background: #1f2937; border-color: #374151; }
  :global(body.dark) .quick-actions select,
  :global(body.dark) .quick-status,
  :global(body.dark) .quick-priority { background: #1f2937; border-color: #374151; color: #f1f5f9; }
  :global(body.dark) .form-input,
  :global(body.dark) .form-textarea,
  :global(body.dark) .members-input,
  :global(body.dark) .members-search-input { background: #111827; border-color: #374151; color: #f1f5f9; }
  :global(body.dark) .member-chip {
    background: rgba(255,255,255,0.06);
    border-color: rgba(255,255,255,0.1);
    color: #e5edf8;
  }
  :global(body.dark) .modal-box { background: #1f2937; border-color: #374151; }
  :global(body.dark) .modal-body { color: #cbd5e1; }
  :global(body.dark) .modal-footer.modal-footer-sticky { background: #1f2937; border-top-color: #374151; }
  :global(body.dark) .members-panel { background: #1f2937; border-color: #374151; }
  :global(body.dark) .search-input { color: #f1f5f9; }
  :global(body.dark) .alert-success { background: #052e16; border-color: #166534; color: #4ade80; }
  :global(body.dark) .alert-error { background: #2d0a0a; border-color: #7f1d1d; color: #f87171; }
  :global(body.dark) .retry-btn { background: #1d4ed8; }
  :global(body.dark) .ov-card { background: #161c27 !important; border-color: #ffffff0f !important; }
  :global(body.dark) .ov-snippet-card {
    background:
      radial-gradient(circle at top right, rgba(96, 165, 250, 0.08), transparent 42%),
      linear-gradient(180deg, rgba(15, 23, 42, 0.85), rgba(15, 23, 42, 0.65)),
      #0d1117 !important;
    border-color: #ffffff0f !important;
  }
  :global(body.dark) .ov-snippet-owner { color: #8da2c0; }
  :global(body.dark) .sub-action-btn { background: #161c27; border-color: #ffffff10; }
  :global(body.dark) .proj-table-panel { background: #0d1117 !important; border-color: #ffffff0f !important; }
  :global(body.dark) .proj-table-header { background: #161c27 !important; border-bottom-color: #ffffff0f !important; color: #e5edf8 !important; }
  :global(body.dark) .proj-table-body { background: #0d1117 !important; }
  :global(body.dark) .proj-table-empty { background: #161c27 !important; border-color: #ffffff12 !important; }
  :global(body.dark) .proj-table-row { background: #161c27 !important; border-color: #ffffff0f !important; }
  :global(body.dark) .icon-btn { background: #161c27; border-color: #ffffff10; }

  @media (max-width: 1080px) {
    .stat-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .quick-head { flex-direction: column; align-items: stretch; gap: 0.65rem; }
    .quick-actions { margin-left: 0; width: 100%; flex-wrap: wrap; justify-content: flex-start; }
    .ov-snippets-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }

  @media (max-width: 768px) {
    .stat-cards { grid-template-columns: 1fr; gap: 10px; }
    .stat-card { padding: 16px; }
    .ov-top-grid { grid-template-columns: 1fr; }
    .projects-cards-mobile { display: grid; }
    .quick-actions { width: 100%; flex-wrap: wrap; gap: 0.5rem; }
    .quick-actions > * { width: 100%; }
    .quick-actions .search-wrap,
    .quick-actions .quick-status,
    .quick-actions .quick-priority,
    .quick-actions .primary { width: 100%; }
    .search-input { width: 100%; }
    .ov-snippets-grid { grid-template-columns: 1fr; }
    .ov-snippet-meta-row { align-items: flex-start; flex-direction: column; }
    .proj-page-footer { justify-content: center; }
    .project-meta { flex-direction: column; align-items: flex-start; gap: 6px; }
    .row-2 { grid-template-columns: 1fr; }
    .detail-manage-footer { flex-direction: column; align-items: stretch; }
    .milestone-create-grid { grid-template-columns: 1fr; }
    .milestone-create-date { max-width: none; width: 100%; }
    .milestone-editor,
    .milestone-editor.inline { grid-template-columns: 1fr; }
    .modal-box.large { width: min(94vw, 720px); }
    .proj-view-overlay { padding: 12px; }
    .proj-view-modal { width: calc(100vw - 24px); max-height: 92vh; border-radius: 14px; }
    .proj-view-head { padding: 14px 14px 12px; }
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
  .proj-view-overlay {
    position: fixed;
    inset: 0;
    padding: 22px;
    background: rgba(3, 7, 18, 0.64);
    backdrop-filter: blur(8px);
    z-index: 260;
  }
  .proj-view-modal {
    width: min(1120px, calc(100vw - 44px));
    max-height: min(90vh, 920px);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    border-radius: 18px;
    border: 1px solid rgba(148, 163, 184, 0.18);
    background: var(--color-surface);
    box-shadow: 0 28px 72px rgba(2, 6, 23, 0.42);
  }
  .proj-view-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 18px 20px 14px;
    border-bottom: 1px solid var(--color-border);
  }
  .proj-view-kicker {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-muted, var(--color-sidebar-text));
  }
  .proj-view-title {
    margin-top: 4px;
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--color-heading);
  }
  .proj-view-close { flex-shrink: 0; }
  .proj-view-body {
    overflow: auto;
    padding-bottom: 1.2rem;
  }
  .feedback-scroll-transparent {
    scrollbar-color: rgba(148, 163, 184, 0.24) transparent;
  }
  .feedback-scroll-transparent::-webkit-scrollbar {
    width: 12px;
  }
  .feedback-scroll-transparent::-webkit-scrollbar-track,
  .feedback-scroll-transparent::-webkit-scrollbar-corner,
  .feedback-scroll-transparent::-webkit-scrollbar-button {
    background: transparent;
  }
  .feedback-scroll-transparent::-webkit-scrollbar-button {
    height: 0;
    width: 0;
  }
  .feedback-scroll-transparent::-webkit-scrollbar-thumb {
    background: rgba(148, 163, 184, 0.24);
    border: 3px solid transparent;
    background-clip: content-box;
    border-radius: 999px;
  }
  :global(body.dark) .proj-view-modal {
    background: #161c27;
    border-color: rgba(148, 163, 184, 0.24);
    box-shadow: 0 30px 80px rgba(2, 6, 23, 0.6);
  }
  :global(body.dark) .proj-view-head {
    border-bottom-color: rgba(255,255,255,0.08);
  }
  :global(body.dark) .proj-view-kicker {
    color: #8da2c0;
  }
  :global(body.dark) .proj-view-title {
    color: #f8fafc;
  }

  .icon-btn-active { background: rgba(59,130,246,0.12) !important; color: #3b82f6 !important; }

  .form-group { display: flex; flex-direction: column; gap: 5px; }
  .form-label { font-size: 12px; font-weight: 600; color: var(--color-sidebar-text); }
  .req { color: #dc2626; }
  .form-input, .form-textarea {
    padding: 8px 10px;
    border-radius: 7px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-muted);
    color: var(--color-text);
    font-size: 13px;
    transition: border-color 0.15s;
    outline: none;
    width: 100%;
    box-sizing: border-box;
  }
  .form-input:focus, .form-textarea:focus { border-color: #2563eb; }
  .form-textarea { resize: vertical; }
  .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .form-alert {
    padding: 10px 12px;
    border-radius: 8px;
    font-size: 12.5px;
    font-weight: 600;
    line-height: 1.45;
    margin-bottom: 10px;
  }
  .form-alert.error {
    background: #fff1f2;
    border: 1px solid #fecdd3;
    color: #be123c;
  }
  .btn-submit {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 20px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    background: #2563eb;
    color: #fff;
    border: none;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-submit:hover:not(:disabled) { background: #1d4ed8; }
  .btn-submit:disabled { opacity: 0.55; cursor: not-allowed; }
  .btn-secondary {
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    background: var(--color-soft);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    cursor: pointer;
  }
  .btn-secondary:hover { background: var(--color-hover); }
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,.45);
    display: grid;
    place-items: center;
    z-index: 200;
  }
  .modal-box {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 24px 26px;
    max-width: 380px;
    width: 90%;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: 0 20px 48px rgba(0,0,0,.18);
  }
  .modal-box.large {
    max-width: 720px;
    width: min(92vw, 720px);
    max-height: 90vh;
    padding: 0;
    gap: 0;
    overflow: hidden;
  }
  .modal-box.large .modal-title { padding: 18px 22px 0; }
  .modal-title { font-size: 15px; font-weight: 700; color: var(--color-heading); }
  .modal-content {
    padding: 12px 22px 16px;
    overflow-y: auto;
    flex: 1;
  }
  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .modal-footer-centered {
    justify-content: center;
  }
  .modal-footer.modal-footer-sticky {
    padding: 12px 22px 16px;
    border-top: 1px solid var(--color-border);
    background: var(--color-surface);
  }
  .modal-body {
    margin: 0;
    color: var(--color-sidebar-text);
    font-size: 13px;
    line-height: 1.5;
  }
  .btn-delete-confirm {
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    background: #dc2626;
    color: #fff;
    border: none;
    cursor: pointer;
  }
  .btn-delete-confirm:hover:not(:disabled) { background: #b91c1c; }
  .btn-delete-confirm:disabled { opacity: 0.55; cursor: not-allowed; }
  .members-input {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 7px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-muted);
    color: var(--color-text);
    font-size: 13px;
    cursor: pointer;
  }
  .members-input:focus { outline: none; border-color: #2563eb; }
  .members-input .muted { font-size: 13px; color: var(--color-sidebar-text); font-weight: 500; }
  .members-panel {
    margin-top: 8px;
    padding: 10px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
  }
  .members-select { display: flex; flex-direction: column; gap: 8px; }
  .members-value { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; flex: 1; }
  .members-placeholder { color: var(--color-sidebar-text); font-weight: 500; }
  .members-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .member-chip {
    max-width: 160px;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    background: var(--color-soft);
    color: var(--color-heading);
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .members-count-text { font-size: 12px; color: var(--color-sidebar-text); font-weight: 600; }
  .members-panel-dropdown { padding: 10px; }
  .members-search { padding: 0 4px 8px; }
  .members-search-input {
    width: 100%;
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-muted);
    color: var(--color-text);
    font-size: 12px;
    outline: none;
  }
  .members-search-input:focus { border-color: #2563eb; }
  .members-list { max-height: 200px; overflow-y: auto; padding-right: 4px; }
  .members-empty { font-size: 12px; color: var(--color-sidebar-text); padding: 4px 8px; display: block; }
  .members-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-radius: 6px;
    cursor: pointer;
    color: var(--color-heading);
    font-size: 13px;
    font-weight: 600;
  }
  .members-item + .members-item { margin-top: 6px; }
  .members-item input[type="checkbox"] { width: 18px; height: 18px; accent-color: #60a5fa; }
  .members-item input[type="checkbox"]:disabled { cursor: not-allowed; opacity: 0.8; }
  .members-lock-hint {
    margin-left: 6px;
    font-size: 11px;
    font-weight: 700;
    color: var(--color-sidebar-text);
  }
  .member-avatar {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border: 1px solid rgba(148,163,184,0.35);
    background: linear-gradient(135deg, rgba(37,99,235,0.28), rgba(14,165,233,0.18));
    color: #dbeafe;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.03em;
  }
  .member-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .members-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .detail-manage-footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.65rem;
    margin-top: 0.85rem;
  }
  .sub-action-bar {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.2rem 1.25rem 0.85rem;
    flex-wrap: wrap;
  }
  .sub-action-bar-inline {
    padding: 0.6rem 0.75rem 0.4rem;
  }
  .milestone-editor {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 180px auto;
    gap: 0.65rem;
    align-items: center;
    padding: 0 1.25rem 0.95rem;
  }
  .milestone-editor.inline {
    padding: 0;
    grid-template-columns: minmax(0, 1fr) 170px 150px auto;
  }
  .milestone-date { min-width: 0; }
  .milestone-editor-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .sub-cancel-btn.danger {
    color: #dc2626;
    font-weight: 600;
  }
  .sub-cancel-btn.danger:hover { color: #b91c1c; }

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
  .proj-detail-read { padding: 0.9rem 1rem 1rem; }
  .pdr-layout { display: grid; grid-template-columns: minmax(0, 1.9fr) minmax(240px, 0.95fr); gap: 1rem; align-items: start; }
  .pdr-main,
  .pdr-sidebar { min-width: 0; }
  .pdr-main { display: flex; flex-direction: column; gap: 0.95rem; }
  .pdr-sidebar { display: flex; flex-direction: column; gap: 0.85rem; }
  .pdr-group { display: flex; flex-direction: column; gap: 0.45rem; }
  .pdr-label {
    font-size: 0.77rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: #64748b;
  }
  :global(body.dark) .pdr-label { color: #475569; }
  .pdr-box {
    font-size: 0.9rem; font-family: inherit; color: var(--color-text);
    background: #ffffff; border: 1px solid rgba(148, 163, 184, 0.08);
    border-radius: 0.8rem; padding: 0.72rem 0.9rem; width: 100%; box-sizing: border-box;
    min-height: 2.1rem;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.75);
  }
  :global(body.dark) .pdr-box {
    background: #161926;
    border-color: rgba(148, 163, 184, 0.08);
    color: #cbd5e1;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
  }
  .pdr-box-hero { font-weight: 600; }
  .pdr-box-desc { white-space: pre-wrap; line-height: 1.6; min-height: 4rem; }
  .detail-description { white-space: pre-wrap; }
  .detail-description.collapsed { display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; line-clamp:3; overflow:hidden; }
  .pdr-inline-link { margin-top: 0.45rem; align-self: flex-start; }
  .pdr-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
  .pdr-box-inline {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    color: #334155;
  }
  .pdr-box-muted { color: #64748b; }
  :global(body.dark) .pdr-box-inline { color: #cbd5e1; }
  :global(body.dark) .pdr-box-muted { color: #94a3b8; }
  .pdr-inline-icon { color: #64748b; flex: 0 0 auto; }
  .pdr-inline-icon-primary { color: #3b82f6; }
  :global(body.dark) .pdr-inline-icon { color: #475569; }
  :global(body.dark) .pdr-inline-icon-primary { color: #3b82f6; }
  .pdr-priority-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    display: inline-block;
    flex: 0 0 auto;
    background: #94a3b8;
  }
  .pdr-priority-dot.priority-low { background: #38bdf8; }
  .pdr-priority-dot.priority-medium { background: #10b981; }
  .pdr-priority-dot.priority-high { background: #f87171; }
  .pdr-progress-stack { display: grid; gap: 0.6rem; }
  .pdr-progress-meta {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    font-size: 0.78rem;
    color: #64748b;
  }
  :global(body.dark) .pdr-progress-meta { color: #64748b; }
  .pdr-footer { display:flex; justify-content:flex-end; margin-top:0.15rem; }
  .pdr-edit-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    min-width: 84px;
    padding: 0.78rem 1.1rem;
    border-radius: 0.85rem;
    border: 1px solid rgba(148, 163, 184, 0.22);
    background: #ffffff;
    color: #0f172a;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.8);
    transition: border-color 0.15s, transform 0.15s, background 0.15s;
  }
  .pdr-edit-btn:hover { transform: translateY(-1px); border-color: rgba(59, 130, 246, 0.35); background: #eff6ff; }
  :global(body.dark) .pdr-edit-btn {
    background: #161926;
    border-color: #3b82f6;
    color: #dbeafe;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
  }
  :global(body.dark) .pdr-edit-btn:hover { background: #1e2540; }
  .pdr-side-card {
    background: #ffffff;
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 0.9rem;
    padding: 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    box-shadow:
      0 14px 28px -30px rgba(15, 23, 42, 0.28),
      inset 0 1px 0 rgba(255,255,255,0.75);
  }
  :global(body.dark) .pdr-side-card {
    background: #161926;
    border-color: rgba(148, 163, 184, 0.16);
    box-shadow:
      0 16px 30px -32px rgba(2, 6, 23, 0.7),
      inset 0 1px 0 rgba(255,255,255,0.03);
  }
  .pdr-side-title {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.77rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: #64748b;
  }
  :global(body.dark) .pdr-side-title { color: #475569; }
  .pdr-person-row { display: flex; align-items: center; gap: 0.55rem; min-width: 0; }
  .pdr-avatar {
    width: 1.7rem;
    height: 1.7rem;
    border-radius: 999px;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: #eff6ff;
    border: 1px solid #93c5fd;
    color: #2563eb;
    font-size: 0.63rem;
    font-weight: 700;
  }
  .pdr-avatar-supervisor { background: #f0fdf4; border-color: #86efac; color: #16a34a; }
  :global(body.dark) .pdr-avatar { background: #1e2540; border-color: #3b82f6; color: #60a5fa; }
  :global(body.dark) .pdr-avatar-supervisor { background: #1e2a1e; border-color: #22c55e; color: #22c55e; }
  .pdr-person-name {
    min-width: 0;
    font-size: 0.84rem;
    color: #64748b;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  :global(body.dark) .pdr-person-name { color: #94a3b8; }
  .pdr-empty-copy { font-size: 0.82rem; color: var(--color-sidebar-text); }
  .pdr-mini-timeline { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.1rem; }
  .pdr-mini-dot { width: 0.5rem; height: 0.5rem; border-radius: 999px; background: #3b82f6; flex: 0 0 auto; }
  .pdr-mini-dot-end { background: #cbd5e1; }
  .pdr-mini-line { flex: 1; height: 1px; background: #e2e8f0; }
  :global(body.dark) .pdr-mini-dot-end { background: #475569; }
  :global(body.dark) .pdr-mini-line { background: #2a2d3a; }
  .pdr-mini-labels { display: flex; justify-content: space-between; font-size: 0.76rem; color: #94a3b8; }
  :global(body.dark) .pdr-mini-labels { color: #475569; }

  /* â”€â”€ Inline Edit Form (Details tab) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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

  .milestone-create-panel {
    margin: 0 0.75rem 0.85rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--color-border, rgba(226,232,240,0.9));
    border-radius: 0.95rem;
    background: color-mix(in srgb, var(--color-surface) 88%, transparent);
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  :global(body.dark) .milestone-create-panel {
    background: #202938;
    border-color: rgba(148,163,184,0.14);
  }
  .milestone-create-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 220px;
    gap: 0.75rem;
    align-items: center;
  }
  .milestone-create-input,
  .milestone-create-date {
    min-height: 2.9rem;
    font-size: 0.95rem;
    border-radius: 0.75rem;
  }
  .milestone-create-date {
    max-width: 220px;
  }
  .milestone-create-links {
    gap: 0.35rem;
  }
  .milestone-create-actions {
    justify-content: flex-start;
  }

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
  .fb-reply-input {
    resize:vertical;
    width:100%;
    font-size:0.82rem;
    font-family:inherit;
    border:1px solid var(--color-border);
    border-radius:6px;
    background:var(--color-surface);
    color:var(--color-heading);
    padding:0.4rem 0.6rem;
    outline:none;
    margin-bottom:6px;
    box-sizing:border-box;
  }
  .fb-reply-input:focus { border-color:#3b82f6; }
  .fb-new-comment {
    display:flex; flex-direction:column;
    padding:0.6rem 0; border-top:1px solid var(--color-border); margin-top:0.25rem;
  }
  .fb-post-btn {
    margin-top: 6px;
    align-self: flex-end;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: #2563eb !important;
    border-color: #2563eb !important;
    color: #ffffff !important;
    transition: opacity 0.16s ease, transform 0.12s ease, filter 0.16s ease;
  }
  .fb-post-btn:hover:not(:disabled) {
    opacity: 0.9;
    filter: saturate(0.94);
  }
  .fb-post-btn:active:not(:disabled) {
    opacity: 0.78;
    transform: translateY(0);
  }
  .fb-post-btn.sub-action-btn-busy {
    background: transparent !important;
    border-color: var(--color-border) !important;
    color: var(--color-sidebar-text) !important;
    opacity: 1;
    box-shadow: none;
  }

  /* Milestones card styles (adopted from ProjectsIntern, adjusted sizes for Supervisor) */
  .milestone-list { display:flex; flex-direction:column; gap:8px; padding:0.5rem 0.75rem; }
  .milestone-row { display:flex; align-items:center; justify-content:space-between; padding:0.6rem 0.75rem; border-radius:8px; background:transparent; }
  .milestone-left { display:flex; gap:12px; align-items:center; }
  .milestone-icon { width:30px; height:30px; display:grid; place-items:center; border-radius:6px; font-size:0.95rem; }
  .milestone-icon { border:1px solid rgba(255,255,255,0.04); }
  .milestone-title { font-size:0.88rem; font-weight:600; color:var(--color-heading); }
  .milestone-due { font-size:0.82rem; color:var(--color-sidebar-text); }

  /* Collapsible milestone cards */
  .ms-card { border:1px solid var(--color-border,rgba(255,255,255,0.08)); border-radius:10px; overflow:hidden; background:var(--color-card,rgba(255,255,255,0.03)); }
  .ms-header { display:flex; align-items:center; gap:10px; padding:0.6rem 0.9rem; cursor:pointer; user-select:none; }
  .ms-header:hover { background:rgba(255,255,255,0.04); }
  .ms-icon { width:12px; height:12px; display:inline-block; border-radius:50%; border:1px solid rgba(255,255,255,0.06); background:transparent; box-shadow: none; }
  .ms-icon.status-not-started { background: rgba(249,115,22,0.06); border-color: rgba(249,115,22,0.08); }
  .ms-icon.status-in-progress { background: rgba(16,185,129,0.06); border-color: rgba(16,185,129,0.08); }
  .ms-icon.status-submitted { background: rgba(124,58,237,0.06); border-color: rgba(124,58,237,0.08); }
  .ms-icon.status-needs-revision { background: rgba(239,68,68,0.06); border-color: rgba(239,68,68,0.08); }
  .ms-icon.status-approved { background: rgba(59,130,246,0.06); border-color: rgba(59,130,246,0.08); }
  .ms-title { flex:1; font-size:0.88rem; font-weight:600; color:var(--color-heading); }
  .ms-due { font-size:0.82rem; color:var(--color-sidebar-text); white-space:nowrap; }
  .ms-chevron { font-size:0.75rem; color:var(--color-sidebar-text); margin-left:4px; }
  .ms-body { padding:0.6rem 0.9rem 0.75rem; border-top:1px solid var(--color-border,rgba(255,255,255,0.06)); display:flex; flex-direction:column; gap:10px; }
  .ms-linked-section { display:flex; flex-direction:column; gap:4px; }
  .ms-linked-label { font-size:0.85rem; font-weight:600; color:var(--color-heading); }
  .ms-linked-list { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:4px; }
  .ms-linked-item { display:flex; align-items:center; gap:8px; font-size:0.88rem; color:var(--color-heading); }
  .ms-open-link { font-size:0.82rem; color:var(--color-link,#60a5fa); text-decoration:none; }
  .ms-open-link:hover { text-decoration:underline; }
  .ms-unlink-btn { background:none; border:none; cursor:pointer; color:var(--color-muted,#9ca3af); font-size:0.75rem; padding:0 2px; }
  .ms-no-links { font-size:0.82rem; color:var(--color-sidebar-text); }
  .ms-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .ms-file-picker { border:1px solid var(--color-border,rgba(255,255,255,0.08)); border-radius:8px; padding:0.6rem 0.8rem; display:flex; flex-direction:column; gap:6px; background:var(--color-bg-alt,rgba(0,0,0,0.15)); }
  .ms-picker-label { font-size:0.83rem; font-weight:600; color:var(--color-heading); }
  .ms-picker-empty { font-size:0.82rem; color:var(--color-sidebar-text); }
  .ms-picker-item { display:flex; align-items:center; gap:8px; cursor:pointer; padding:3px 0; }
  .ms-picker-name { font-size:0.85rem; color:var(--color-heading); flex:1; }
  .ms-picker-folder { font-size:0.75rem; color:var(--color-sidebar-text); }

  </style>
