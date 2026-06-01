
<script>
  import { onMount } from 'svelte';
  import { Upload, Link2, Folder, FolderOpen, FileText, Download, Trash2, Eye, Plus, Search, Share2, Copy, X, Check, ChevronRight, Loader2, Files, Clock, Lock, Pencil } from 'lucide-svelte';
  import * as authApi from '../lib/auth.js';

  // Folder structure
  const folderStructure = {
    root: {
      name: 'My Documents',
      path: '/',
      subfolders: [], // Now stores folder objects with {path, name, createdBy, createdByName}
    },
  };

  let documents = [];
  let isLoading = true;
  let userId = null;

  let searchQuery = '';
  let currentFolder = '/';
  let showUploadModal = false;
  let showLinkModal = false;
  let showShareModal = false;
  let showCreateFolderModal = false;
  let selectedDocForShare = null;
  let newLinkName = '';
  let newLinkUrl = '';
  let shareEmail = '';
  let shareRole = 'Viewer';
  let shareVisibilityMode = 'private'; // private | everyone | specific | everyone_except
  let shareCandidates = [];
  let shareCandidateSearch = '';
  let selectedShareUserIds = new Set();
  let retainedShareEntries = [];
  let isApplyingShareVisibility = false;
  let copiedId = null;
  let uploadToFolder = '/';
  let folderSearchQuery = '';
  let newFolderName = '';
  let isCreatingFolder = false;
  let showRenameFolderModal = false;
  let folderToRename = null;
  let renameFolderInputValue = '';
  let folderToDelete = null;
  let showDeleteFolderConfirm = false;
  let isDeletingFolder = false;
  let showUploadPreview = false;
  let pendingFile = null;
  let pendingFilePreview = null;
  let isUploading = false;
  let actionMessage = '';
  let actionMessageType = 'success';
  let actionMessageTimer = null;
  let isAddingLink = false;
  
  // Group Workspace State
  let currentUser = null;
  let isSupervisor = false;
  let isGroupView = true;
  let documentFilter = 'all'; // 'all', 'my', 'shared', 'folders'
  let selectedFolder = null; // For folder filter
  
  // Bulk Selection State
  let showBulkActions = false;
  let selectedDocuments = new Set();
  let selectAllChecked = false;

  // Delete Document Confirmation State
  let showDeleteConfirm = false;
  let documentToDelete = null;
  let isDeleting = false;

  // Bulk Delete Confirmation State
  let showBulkDeleteConfirm = false;
  let isDeleteBulkProcessing = false;
  let showBulkMoveModal = false;
  let bulkMoveTargetFolder = '/';
  let isBulkMoveProcessing = false;
  let isBulkDuplicateProcessing = false;

  // Sort State
  let documentSort = 'date'; // 'date', 'name', or 'size'

  // Folder Selection in Folders Tab
  let selectedFolderInTab = null;

  // Folder Bulk Selection State
  let selectedFolders = new Set();
  let selectAllFoldersChecked = false;
  let showFolderBulkActions = false;
  let showDeleteFoldersConfirm = false;
  let isDeleteFoldersProcessing = false;

  const AUTH_SESSION_STORAGE_KEY = 'ims-auth-session-user';

  $: filteredDocuments = documents.filter((doc) => {
    const ownerId = getDocumentOwnerId_(doc);
    const accessLevel = String(doc.accessLevel || doc.access_level || 'private').trim().toLowerCase() || 'private';
    const matchesSearch = doc.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFolder = currentFolder === '/' || doc.folder === currentFolder;
    
    // Apply document filter
    let matchesFilter = true;
    if (documentFilter === 'my') {
      matchesFilter = ownerId === userId;
    } else if (documentFilter === 'shared') {
      const isSharedWithMe = Array.isArray(doc.sharedWith) && doc.sharedWith.some(s => s.email === currentUser?.email || s.id === userId);
      matchesFilter = isSharedWithMe && ownerId !== userId;
    } else if (documentFilter === 'folders') {
      // When filtering by folders, show documents from the selected folder
      matchesFilter = selectedFolder ? doc.folder === selectedFolder : true;
    } else if (documentFilter === 'all') {
      // Keep private documents out of All Documents; they remain in My Documents.
      matchesFilter = accessLevel !== 'private';
    }
    
    return matchesSearch && matchesFolder && matchesFilter;
  }).sort((a, b) => {
    if (documentSort === 'name') {
      return a.name.localeCompare(b.name);
    } else if (documentSort === 'size') {
      // Sort by size (largest first)
      const sizeA = parseFloat(a.size) || 0;
      const sizeB = parseFloat(b.size) || 0;
      return sizeB - sizeA;
    } else {
      // Sort by date (newest first)
      const dateA = new Date(a.uploadedDate || a.created_date || 0).getTime();
      const dateB = new Date(b.uploadedDate || b.created_date || 0).getTime();
      return dateB - dateA;
    }
  });

  $: normalizedFolders = folderStructure.root.subfolders
    .map((folder) => typeof folder === 'string' ? folder : folder.path)
    .filter(Boolean);
  $: currentChildFolders = folderStructure.root.subfolders.filter((folder) => {
    const folderPath = typeof folder === 'string' ? folder : folder.path;
    return getParentFolderPath_(folderPath) === currentFolder;
  });
  $: folderDocuments = documents.filter(doc => normalizeFolderPath_(doc.folder) === currentFolder);
  $: documentsInFolder = folderDocuments.length;
  $: currentFolderName = currentFolder === '/' ? '' : getFolderNameFromPath_(currentFolder);
  $: isFolderOpen = documentFilter === 'folders' && currentFolder !== '/';
  $: deletableFilteredDocuments = filteredDocuments.filter((doc) => canDeleteDocument_(doc));
  $: if (showBulkActions) {
    const allowedIds = new Set(deletableFilteredDocuments.map((doc) => doc.id));
    let changed = false;
    for (const selectedId of Array.from(selectedDocuments)) {
      if (!allowedIds.has(selectedId)) {
        selectedDocuments.delete(selectedId);
        changed = true;
      }
    }
    if (changed) {
      selectedDocuments = selectedDocuments;
    }
    updateSelectAllStatus();
  }

  function normalizeFolderPath_(value) {
    const raw = String(value?.path || value || '').trim();
    if (!raw || raw === '/') return '/';
    const cleaned = raw
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '')
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean)
      .join('/');
    return cleaned ? '/' + cleaned : '/';
  }

  function getFolderNameFromPath_(folderPath) {
    const normalized = normalizeFolderPath_(folderPath);
    if (normalized === '/') return 'Folders';
    return normalized.split('/').filter(Boolean).pop() || 'Folders';
  }

  function getParentFolderPath_(folderPath) {
    const parts = normalizeFolderPath_(folderPath).split('/').filter(Boolean);
    if (parts.length <= 1) return '/';
    return '/' + parts.slice(0, -1).join('/');
  }

  function getFolderDocumentCount_(folderPath) {
    const normalized = normalizeFolderPath_(folderPath);
    return documents.filter((doc) => normalizeFolderPath_(doc.folder) === normalized).length;
  }

  function isFolderPathInTree_(path, folderPath) {
    const normalizedPath = normalizeFolderPath_(path);
    const normalizedFolder = normalizeFolderPath_(folderPath);
    return normalizedPath === normalizedFolder || normalizedPath.startsWith(normalizedFolder + '/');
  }

  function getFolderTreeDocumentCount_(folderPath) {
    const normalized = normalizeFolderPath_(folderPath);
    return documents.filter((doc) => isFolderPathInTree_(doc.folder, normalized)).length;
  }

  function parseStoredAuthUserId_() {
    if (typeof window === 'undefined') {
      return '';
    }

    try {
      const raw = window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
      if (!raw) return '';
      const parsed = JSON.parse(raw);
      return String(parsed?.user_id || '').trim();
    } catch {
      return '';
    }
  }

  function resolveCurrentUserId_() {
    const authUser = authApi.getCurrentUser();
    const fromAuthModule = String(authUser?.user_id || '').trim();
    if (fromAuthModule) return fromAuthModule;

    const fromStoredSession = parseStoredAuthUserId_();
    if (fromStoredSession) return fromStoredSession;

    if (typeof window !== 'undefined') {
      const legacyCurrentUser = String(window.localStorage.getItem('current_user_id') || '').trim();
      if (legacyCurrentUser) return legacyCurrentUser;

      return String(window['__ims_user_id'] || '').trim();
    }

    return '';
  }

  function mapDocumentFromApi_(rawDoc) {
    const doc = rawDoc && typeof rawDoc === 'object' ? rawDoc : {};
    const isLink = doc.isLink === true || String(doc.is_link || '').toLowerCase() === 'true' || String(doc.type || '').toLowerCase() === 'link';
    const accessLevel = String(doc.accessLevel || doc.access_level || 'private').trim().toLowerCase() || 'private';
    const sharedWith = Array.isArray(doc.sharedWith)
      ? doc.sharedWith
      : Array.isArray(doc.shared_with)
        ? doc.shared_with
        : [];

    return {
      ...doc,
      id: String(doc.id || ''),
      user_id: String(doc.user_id || doc.userId || ''),
      name: String(doc.name || ''),
      folder: normalizeFolderPath_(doc.folder || '/'),
      type: String(doc.type || (isLink ? 'link' : 'file')),
      size: String(doc.size || ''),
      url: String(doc.url || ''),
      isLink,
      is_link: isLink,
      uploadedDate: String(doc.uploadedDate || doc.uploaded_date || ''),
      uploaded_date: String(doc.uploadedDate || doc.uploaded_date || ''),
      accessLevel,
      access_level: accessLevel,
      sharedWith,
      shared_with: sharedWith,
      created_by: String(doc.created_by || doc.user_id || doc.userId || ''),
      created_date: String(doc.created_date || ''),
    };
  }

  function getDocumentOwnerId_(doc) {
    const value = doc && typeof doc === 'object' ? doc : {};
    return String(value.created_by || value.user_id || '').trim();
  }

  function canDeleteDocument_(doc) {
    if (isSupervisor) return true;
    const ownerId = getDocumentOwnerId_(doc);
    return Boolean(ownerId) && ownerId === String(userId || '').trim();
  }

  function canManageShare_(doc) {
    if (isSupervisor) return true;
    const ownerId = getDocumentOwnerId_(doc);
    return Boolean(ownerId) && ownerId === String(userId || '').trim();
  }

  function fileToBase64_(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('No file selected.'));
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        const commaIndex = dataUrl.indexOf(',');
        resolve(commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : '');
      };
      reader.onerror = () => reject(new Error('Unable to read selected file.'));
      reader.readAsDataURL(file);
    });
  }

  function showActionMessage_(message, type = 'success') {
    actionMessage = String(message || '').trim();
    actionMessageType = type === 'error' ? 'error' : 'success';

    if (actionMessageTimer) {
      clearTimeout(actionMessageTimer);
    }

    actionMessageTimer = setTimeout(() => {
      actionMessage = '';
      actionMessageTimer = null;
    }, 3200);
  }

  function getDefaultUploadFolder_() {
    const firstFolder = normalizedFolders[0];
    return firstFolder || '/';
  }

  function openUploadModal_() {
    uploadToFolder = currentFolder !== '/' ? currentFolder : uploadToFolder;
    showUploadModal = true;
  }

  function openDocumentFolder_(folderName) {
    const normalizedFolder = normalizeFolderPath_(folderName);
    if (!normalizedFolder || normalizedFolder === '/') return;
    documentFilter = 'folders';
    currentFolder = normalizedFolder;
    selectedFolderInTab = normalizedFolder;
    selectedDocuments = new Set();
    selectAllChecked = false;
    showBulkActions = false;
    uploadToFolder = currentFolder;
  }

  function closeDocumentFolder_() {
    currentFolder = '/';
    selectedFolderInTab = null;
    selectedDocuments = new Set();
    selectAllChecked = false;
    showBulkActions = false;
    uploadToFolder = '/';
  }

  function goToParentFolder_() {
    if (currentFolder === '/') return;
    const parentPath = getParentFolderPath_(currentFolder);
    currentFolder = parentPath;
    selectedFolderInTab = parentPath === '/' ? null : parentPath;
    uploadToFolder = parentPath;
    // Reset filter when going back to root
    if (parentPath === '/') {
      documentFilter = 'all';
    }
  }

  function openLinkModal_() {
    uploadToFolder = currentFolder !== '/' ? currentFolder : uploadToFolder;
    showLinkModal = true;
  }

  // API Call helper
  function callBackend_(action, payload) {
    return new Promise((resolve, reject) => {
      const scriptRunner = window?.['google']?.script?.run;
      if (!scriptRunner) {
        reject(new Error('Apps Script bridge is not ready.'));
        return;
      }

      scriptRunner
        .withSuccessHandler((response) => {
          resolve(response);
        })
        .withFailureHandler((error) => {
          reject(error);
        })
        .apiAction(action, payload);
    });
  }

  // Load documents from backend
  async function loadDocuments_() {
    try {
      isLoading = true;
      const response = await callBackend_('get_all_documents', { user_id: userId });
      if (response.ok) {
        documents = Array.isArray(response.documents)
          ? response.documents.map(mapDocumentFromApi_)
          : [];
      } else {
        console.error('Failed to load documents:', response.error);
      }
    } catch (err) {
      console.error('Error loading documents:', err);
    } finally {
      isLoading = false;
    }
  }

  async function loadFolders_() {
    try {
      const response = await callBackend_('get_document_folders', { user_id: userId });
      if (response?.ok && Array.isArray(response.folders) && response.folders.length > 0) {
        // Load all folders, with or without creator info
        folderStructure.root.subfolders = response.folders.map((folder) => {
          // Handle both string paths (legacy) and folder objects
          if (typeof folder === 'string') {
            return {
              path: normalizeFolderPath_(folder),
              name: folder.substring(1),
              createdBy: '',
              createdByName: '–',
            };
          }
          
          // Map database columns to camelCase: created_by_name -> createdByName
          const displayName = folder.created_by_name || folder.createdByName || folder.created_by || folder.createdBy || '–';
          return {
            path: normalizeFolderPath_(folder.path || folder.name),
            name: folder.name,
            ownerUserId: folder.user_id || folder.userId || '',
            createdBy: folder.created_by || folder.createdBy || folder.user_id || folder.userId || '',
            createdByName: displayName,
          };
        });
      } else {
        folderStructure.root.subfolders = [];
      }
    } catch (err) {
      console.error('Error loading folders:', err);
    } finally {
      if (!uploadToFolder || uploadToFolder === '/') {
        uploadToFolder = getDefaultUploadFolder_();
      }
    }
  }

  async function loadInitialData_() {
    try {
      isLoading = true;
      const response = await callBackend_('get_documents_bootstrap_data', { user_id: userId });
      
      if (response?.ok) {
        // Update folders - load all folders
        if (Array.isArray(response.folders)) {
          folderStructure.root.subfolders = response.folders.map((folder) => {
            // Handle both string paths (legacy) and folder objects
            if (typeof folder === 'string') {
              return {
                path: normalizeFolderPath_(folder),
                name: folder.substring(1),
                createdBy: '',
                createdByName: '–',
              };
            }
            
            // Map database columns to camelCase: created_by_name -> createdByName
            const displayName = folder.created_by_name || folder.createdByName || folder.created_by || folder.createdBy || '–';
            return {
              path: normalizeFolderPath_(folder.path || folder.name),
              name: folder.name,
              ownerUserId: folder.user_id || folder.userId || '',
              createdBy: folder.created_by || folder.createdBy || folder.user_id || folder.userId || '',
              createdByName: displayName,
            };
          });
        } else {
          folderStructure.root.subfolders = [];
        }
        
        // Update documents
        documents = Array.isArray(response.documents)
          ? response.documents.map(mapDocumentFromApi_)
          : [];
      } else {
        console.error('Failed to load initial docs data:', response?.error);
      }
    } catch (err) {
      console.error('Error in bootstrap loading:', err);
    } finally {
      isLoading = false;
      if (!uploadToFolder || uploadToFolder === '/') {
        uploadToFolder = getDefaultUploadFolder_();
      }
    }
  }

  async function handleFileUpload(event) {
    const files = event.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.size > 50 * 1024 * 1024) {
        alert('File is too large. Maximum file size is 50MB.');
        return;
      }

      // Create preview without saving to database yet
      pendingFile = {
        name: file.name,
        type: file.type.includes('pdf') ? 'pdf' : 'file',
        size: (file.size / 1024 / 1024).toFixed(1) + ' MB',
        folder: uploadToFolder,
        rawFile: file,
        mimeType: String(file.type || 'application/octet-stream'),
      };
      
      pendingFilePreview = {
        ...pendingFile,
        uploadedDate: new Date().toISOString().slice(0, 10),
      };
      
      showUploadPreview = true;
      showUploadModal = false;
    }
  }

  async function confirmUpload() {
    if (!pendingFile || isUploading) return;
    
    try {
      isUploading = true;
      const fileDataBase64 = await fileToBase64_(pendingFile.rawFile);

      const response = await callBackend_('upload_document', {
        user_id: userId,
        name: pendingFile.name,
        type: pendingFile.type,
        size: pendingFile.size,
        folder: pendingFile.folder,
        uploaded_date: new Date().toISOString().slice(0, 10),
        is_link: false,
        file_name: pendingFile.name,
        mime_type: pendingFile.mimeType,
        file_data_base64: fileDataBase64,
      });

      if (response.ok) {
        await loadDocuments_();
        showUploadModal = false;
        showUploadPreview = false;
        uploadToFolder = currentFolder !== '/' ? currentFolder : '/';
        pendingFile = null;
        pendingFilePreview = null;
        showActionMessage_('Document uploaded and saved to database.');
      } else {
        showActionMessage_('Upload failed: ' + (response.error || 'Unknown error.'), 'error');
        alert('Error uploading document: ' + response.error);
      }
    } catch (err) {
      console.error('Upload error:', err);
      showActionMessage_('Upload failed. Please try again.', 'error');
      alert('Error uploading document');
    } finally {
      isUploading = false;
    }
  }

  function cancelUpload() {
    if (isUploading) return;
    showUploadPreview = false;
    showUploadModal = true;
    pendingFile = null;
    pendingFilePreview = null;
  }

  function closeUploadModal() {
    showUploadModal = false;
    folderSearchQuery = '';
  }

  async function addLink() {
    if (newLinkName.trim() && newLinkUrl.trim()) {
      if (isAddingLink) return;

      let normalizedUrl = '';
      try {
        normalizedUrl = new URL(newLinkUrl.trim()).toString();
      } catch {
        alert('Please enter a valid URL.');
        return;
      }

      try {
        isAddingLink = true;
        const response = await callBackend_('upload_document', {
          user_id: userId,
          name: newLinkName.trim(),
          type: 'link',
          url: normalizedUrl,
          folder: uploadToFolder,
          uploaded_date: new Date().toISOString().slice(0, 10),
          is_link: true
        });

        if (response.ok) {
          await loadDocuments_();
          newLinkName = '';
          newLinkUrl = '';
          showLinkModal = false;
          uploadToFolder = currentFolder !== '/' ? currentFolder : '/';
          showActionMessage_('Link uploaded and saved to database.');
        } else {
          showActionMessage_('Add link failed: ' + (response.error || 'Unknown error.'), 'error');
          alert('Error adding link: ' + response.error);
        }
      } catch (err) {
        console.error('Link error:', err);
        showActionMessage_('Add link failed. Please try again.', 'error');
        alert('Error adding link');
      } finally {
        isAddingLink = false;
      }
    }
  }

  function openShareModal(doc) {
    if (!canManageShare_(doc)) {
      showActionMessage_('Only the document owner or supervisor can manage visibility.', 'error');
      return;
    }
    selectedDocForShare = doc;
    showShareModal = true;
    shareEmail = '';
    shareCandidateSearch = '';
    selectedShareUserIds = new Set();
    shareVisibilityMode = 'private';
    loadShareCandidates_().then(() => {
      restoreShareModalStateFromDoc_();
    });
  }

  async function loadShareCandidates_() {
    try {
      const response = await callBackend_('get_document_share_candidates', { user_id: userId });
      if (response?.ok && Array.isArray(response.users)) {
        shareCandidates = response.users
          .filter((u) => String(u.user_id || '').trim() !== String(userId || '').trim())
          .map((u) => ({ ...u, user_id: String(u.user_id || '').trim() }));
      } else {
        shareCandidates = [];
      }
    } catch (err) {
      console.error('Load share candidates error:', err);
      shareCandidates = [];
    }
  }

  function restoreShareModalStateFromDoc_() {
    if (!selectedDocForShare) return;
    const mode = String(selectedDocForShare.accessLevel || selectedDocForShare.access_level || 'private').trim().toLowerCase();
    const sharedEntries = Array.isArray(selectedDocForShare.sharedWith) ? selectedDocForShare.sharedWith : [];
    const selectedEmails = new Set(sharedEntries.map((entry) => String(entry.email || '').trim().toLowerCase()).filter(Boolean));
    const candidateEmails = new Set(shareCandidates.map((candidate) => String(candidate.email || '').trim().toLowerCase()).filter(Boolean));

    if (mode === 'everyone' || mode === 'private') {
      shareVisibilityMode = mode;
      selectedShareUserIds = new Set();
      retainedShareEntries = [];
      return;
    }

    if (mode === 'everyone_except') {
      shareVisibilityMode = 'everyone_except';
    } else {
      shareVisibilityMode = 'specific';
    }

    const selectedIds = new Set();
    for (const candidate of shareCandidates) {
      const candidateEmail = String(candidate.email || '').trim().toLowerCase();
      if (selectedEmails.has(candidateEmail)) {
        selectedIds.add(candidate.user_id);
      }
    }
    selectedShareUserIds = selectedIds;
    retainedShareEntries = sharedEntries.filter((entry) => {
      const entryEmail = String(entry.email || '').trim().toLowerCase();
      return entryEmail && !candidateEmails.has(entryEmail);
    });
  }

  function toggleShareCandidate_(candidateUserId) {
    if (selectedShareUserIds.has(candidateUserId)) {
      selectedShareUserIds.delete(candidateUserId);
    } else {
      selectedShareUserIds.add(candidateUserId);
    }
    selectedShareUserIds = selectedShareUserIds;
  }

  $: filteredShareCandidates = shareCandidates.filter((candidate) => {
    const query = String(shareCandidateSearch || '').trim().toLowerCase();
    if (!query) return true;
    const name = String(candidate.full_name || '').toLowerCase();
    const role = String(candidate.role || '').toLowerCase();
    const email = String(candidate.email || '').toLowerCase();
    return name.includes(query) || role.includes(query) || email.includes(query);
  });

  $: selectedSharePreview = shareCandidates.filter((candidate) => selectedShareUserIds.has(candidate.user_id));

  async function applyShareVisibility() {
    if (!selectedDocForShare) return;
    if (!canManageShare_(selectedDocForShare)) {
      showActionMessage_('Only the document owner or supervisor can manage visibility.', 'error');
      return;
    }
    if (isApplyingShareVisibility) return;
    isApplyingShareVisibility = true;
    try {
      const docId = selectedDocForShare.id;
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const selectedUsers = shareCandidates.filter((u) => selectedShareUserIds.has(u.user_id));
      const selectedEmails = selectedUsers.map((u) => String(u.email || '').trim()).filter(Boolean).filter((email) => emailRegex.test(email));
      const retainedShares = retainedShareEntries
        .map((entry) => ({
          email: String(entry.email || '').trim(),
          role: String(entry.role || 'Viewer').trim() || 'Viewer',
          sharedDate: String(entry.sharedDate || '').trim() || new Date().toISOString().slice(0, 10)
        }))
        .filter((entry) => emailRegex.test(entry.email));
      const nextSharedWithFromSelection = selectedUsers.map((u) => ({
        email: String(u.email || '').trim(),
        role: 'Viewer',
        sharedDate: new Date().toISOString().slice(0, 10)
      }));
      const nextSharedWith = Array.from(
        new Map(
          [...retainedShares, ...nextSharedWithFromSelection]
            .filter((entry) => emailRegex.test(entry.email))
            .map((entry) => [entry.email.toLowerCase(), entry])
        ).values()
      );

      if (shareVisibilityMode === 'private') {
        await callBackend_('update_document_visibility', {
          user_id: userId,
          doc_id: docId,
          access_level: 'private',
          shared_with: []
        });
        await loadDocuments_();
        selectedDocForShare = documents.find((d) => d.id === docId) || selectedDocForShare;
        retainedShareEntries = [];
        showActionMessage_('Visibility set to Only me.');
        showShareModal = false;
        return;
      }

      if (shareVisibilityMode === 'specific') {
        if (selectedEmails.length === 0) {
          showActionMessage_('Select at least one user for specific people.', 'error');
          return;
        }
        await callBackend_('update_document_visibility', {
          user_id: userId,
          doc_id: docId,
          access_level: 'specific',
          shared_with: nextSharedWith
        });
        await loadDocuments_();
        selectedDocForShare = documents.find((d) => d.id === docId) || selectedDocForShare;
        showActionMessage_('Visibility updated for specific people.');
        showShareModal = false;
        return;
      }

      if (shareVisibilityMode === 'everyone') {
        await callBackend_('update_document_visibility', {
          user_id: userId,
          doc_id: docId,
          access_level: 'everyone',
          shared_with: []
        });
        await loadDocuments_();
        selectedDocForShare = documents.find((d) => d.id === docId) || selectedDocForShare;
        retainedShareEntries = [];
        showActionMessage_('Visibility updated for everyone.');
        showShareModal = false;
        return;
      }

      if (shareVisibilityMode === 'everyone_except') {
        if (selectedEmails.length === 0) {
          showActionMessage_('Select at least one user to exclude.', 'error');
          return;
        }
        await callBackend_('update_document_visibility', {
          user_id: userId,
          doc_id: docId,
          access_level: 'everyone_except',
          shared_with: nextSharedWith
        });
        await loadDocuments_();
        selectedDocForShare = documents.find((d) => d.id === docId) || selectedDocForShare;
        showActionMessage_('Visibility updated for everyone except selected people.');
        showShareModal = false;
        return;
      }
    } finally {
      isApplyingShareVisibility = false;
    }
  }

  async function shareDocument() {
    if (!selectedDocForShare || !shareEmail.trim()) return;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(shareEmail)) {
      alert('Please enter a valid email address');
      return;
    }

    try {
      const response = await callBackend_('share_document', {
        user_id: userId,
        doc_id: selectedDocForShare.id,
        email: shareEmail,
        role: shareRole
      });

      if (response.ok) {
        // Update local document
        const docIndex = documents.findIndex(d => d.id === selectedDocForShare.id);
        if (docIndex !== -1) {
          const currentDoc = mapDocumentFromApi_(documents[docIndex]);
          const nextSharedWith = [
            ...(Array.isArray(currentDoc.sharedWith) ? currentDoc.sharedWith : []),
            {
            email: shareEmail,
            role: shareRole,
            sharedDate: new Date().toISOString().slice(0, 10),
            },
          ];

          const updatedDoc = {
            ...currentDoc,
            sharedWith: nextSharedWith,
            shared_with: nextSharedWith,
            accessLevel: 'shared',
            access_level: 'shared',
          };

          documents = [
            ...documents.slice(0, docIndex),
            updatedDoc,
            ...documents.slice(docIndex + 1),
          ];
          selectedDocForShare = updatedDoc;
        }
        shareEmail = '';
        shareRole = 'Viewer';
      } else {
        alert('Error sharing document: ' + response.error);
      }
    } catch (err) {
      console.error('Share error:', err);
      alert('Error sharing document');
    }
  }

  async function removeShare(docId, email) {
    try {
      const response = await callBackend_('remove_share', {
        user_id: userId,
        doc_id: docId,
        email: email
      });

      if (response.ok) {
        const docIndex = documents.findIndex(d => d.id === docId);
        if (docIndex !== -1) {
          const currentDoc = mapDocumentFromApi_(documents[docIndex]);
          const nextSharedWith = (Array.isArray(currentDoc.sharedWith) ? currentDoc.sharedWith : []).filter((s) => s.email !== email);
          const nextAccessLevel = nextSharedWith.length === 0 ? 'private' : 'shared';

          const updatedDoc = {
            ...currentDoc,
            sharedWith: nextSharedWith,
            shared_with: nextSharedWith,
            accessLevel: nextAccessLevel,
            access_level: nextAccessLevel,
          };

          documents = [
            ...documents.slice(0, docIndex),
            updatedDoc,
            ...documents.slice(docIndex + 1),
          ];
          if (selectedDocForShare && selectedDocForShare.id === docId) {
            selectedDocForShare = updatedDoc;
          }
        }
      } else {
        alert('Error removing share: ' + response.error);
      }
    } catch (err) {
      console.error('Remove share error:', err);
      alert('Error removing share');
    }
  }

  function copyShareLink(docId) {
    const shareLink = `${window.location.origin}/#/documents/${docId}`;
    navigator.clipboard.writeText(shareLink);
    copiedId = docId;
    setTimeout(() => {
      copiedId = null;
    }, 2000);
  }

  function resolveDocumentUrl_(doc) {
    if (!doc || typeof doc !== 'object') {
      return '';
    }

    const candidates = [
      doc.url,
      doc.link,
      doc.file_url,
      doc.fileUrl,
      doc.document_url,
      doc.documentUrl,
      doc.web_view_link,
      doc.webViewLink,
      doc.preview_url,
      doc.previewUrl,
    ];

    for (const candidate of candidates) {
      const value = String(candidate || '').trim();
      if (value && value !== '#') {
        return value;
      }
    }

    return '';
  }

  function openDocument(doc, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    const targetUrl = resolveDocumentUrl_(doc);
    if (!targetUrl) {
      showActionMessage_('This document has no preview link yet.', 'error');
      return;
    }

    const openedWindow = window.open(targetUrl, '_blank');
    if (!openedWindow) {
      showActionMessage_('Popup blocked. Please allow popups for this site.', 'error');
    }
  }

  async function deleteDocument(id) {
    isDeleting = true;
    try {
      const response = await callBackend_('delete_document', {
        user_id: userId,
        doc_id: id
      });

      if (response && response.ok) {
        documents = documents.filter((doc) => doc.id !== id);
        showDeleteConfirm = false;
        documentToDelete = null;
        showActionMessage_('Document deleted successfully.');
      } else {
        const errorMsg = response?.error || response?.message || 'Unknown error occurred';
        showActionMessage_(`Error: ${errorMsg}`, 'error');
        console.error('Delete failed:', response);
      }
    } catch (err) {
      console.error('Delete error:', err);
      showActionMessage_('Error deleting document. Please try again.', 'error');
    } finally {
      isDeleting = false;
    }
  }

  function openDeleteConfirm(doc) {
    if (!canDeleteDocument_(doc)) {
      showActionMessage_('You do not have permission to delete this document.', 'error');
      return;
    }
    documentToDelete = doc;
    showDeleteConfirm = true;
  }

  function toggleBulkActions() {
    showBulkActions = !showBulkActions;
    if (!showBulkActions) {
      selectedDocuments.clear();
      selectAllChecked = false;
    }
  }

  function toggleDocumentSelection(doc) {
    if (!canDeleteDocument_(doc)) {
      showActionMessage_('You do not have permission to delete this document.', 'error');
      return;
    }

    if (selectedDocuments.has(doc.id)) {
      selectedDocuments.delete(doc.id);
    } else {
      selectedDocuments.add(doc.id);
    }
    selectedDocuments = selectedDocuments; // trigger reactivity
    updateSelectAllStatus();
  }

  function toggleSelectAll() {
    if (selectAllChecked) {
      // Deselect all
      selectedDocuments.clear();
      selectAllChecked = false;
    } else {
      // Select all visible documents that the user can delete
      deletableFilteredDocuments.forEach(doc => selectedDocuments.add(doc.id));
      selectAllChecked = true;
    }
    selectedDocuments = selectedDocuments; // trigger reactivity
  }

  function updateSelectAllStatus() {
    if (deletableFilteredDocuments.length === 0) {
      selectAllChecked = false;
    } else {
      selectAllChecked = deletableFilteredDocuments.every(doc => selectedDocuments.has(doc.id));
    }
  }

  async function deleteBulkDocuments() {
    if (selectedDocuments.size === 0) return;
    showBulkDeleteConfirm = true;
  }

  async function confirmBulkDelete() {
    if (selectedDocuments.size === 0) return;
    isDeleteBulkProcessing = true;

    try {
      let successCount = 0;
      let errorCount = 0;

      for (const docId of selectedDocuments) {
        try {
          const response = await callBackend_('delete_document', {
            user_id: userId,
            doc_id: docId
          });

          if (response && response.ok) {
            successCount++;
            documents = documents.filter((doc) => doc.id !== docId);
          } else {
            errorCount++;
            console.error('Delete failed for doc:', docId, response);
          }
        } catch (err) {
          console.error('Error deleting document:', docId, err);
          errorCount++;
        }
      }

      // Clear selection
      selectedDocuments.clear();
      selectAllChecked = false;
      selectedDocuments = selectedDocuments; // trigger reactivity
      showBulkDeleteConfirm = false;
      isDeleteBulkProcessing = false;

      if (errorCount === 0) {
        showActionMessage_(`Successfully deleted ${successCount} document${successCount !== 1 ? 's' : ''}.`);
      } else {
        showActionMessage_(`Deleted ${successCount} document${successCount !== 1 ? 's' : ''}. Failed to delete ${errorCount}.`, 'error');
      }
    } catch (err) {
      console.error('Bulk delete error:', err);
      showActionMessage_('Error deleting documents', 'error');
      showBulkDeleteConfirm = false;
      isDeleteBulkProcessing = false;
    }
  }

  async function moveBulkDocuments() {
    if (selectedDocuments.size === 0) return;
    if (normalizedFolders.length === 0) {
      showActionMessage_('Create at least one folder before moving documents.', 'error');
      return;
    }
    bulkMoveTargetFolder = currentFolder !== '/' ? currentFolder : normalizedFolders[0];
    if (!normalizedFolders.includes(bulkMoveTargetFolder)) {
      bulkMoveTargetFolder = normalizedFolders[0];
    }
    showBulkMoveModal = true;
  }

  function closeBulkMoveModal() {
    if (isBulkMoveProcessing) return;
    showBulkMoveModal = false;
  }

  async function confirmBulkMove() {
    const targetFolder = normalizeFolderPath_(bulkMoveTargetFolder);
    if (targetFolder !== '/' && !normalizedFolders.includes(targetFolder)) {
      showActionMessage_('Invalid target folder selected.', 'error');
      return;
    }
    isBulkMoveProcessing = true;

    let successCount = 0;
    let errorCount = 0;

    for (const docId of selectedDocuments) {
      try {
        const response = await callBackend_('move_document', {
          user_id: userId,
          doc_id: docId,
          folder: targetFolder,
        });

        if (response?.ok) {
          successCount++;
          documents = documents.map((doc) => doc.id === docId ? { ...doc, folder: targetFolder } : doc);
        } else {
          errorCount++;
        }
      } catch (err) {
        console.error('Bulk move error:', docId, err);
        errorCount++;
      }
    }

    selectedDocuments.clear();
    selectedDocuments = selectedDocuments;
    selectAllChecked = false;
    isBulkMoveProcessing = false;
    showBulkMoveModal = false;

    if (errorCount === 0) {
      showActionMessage_(`Moved ${successCount} document${successCount !== 1 ? 's' : ''}.`);
    } else {
      showActionMessage_(`Moved ${successCount}. Failed to move ${errorCount}.`, 'error');
    }
  }

  async function removeSelectedFromCurrentFolder() {
    if (selectedDocuments.size === 0) return;
    if (!isFolderOpen || currentFolder === '/') return;

    isBulkMoveProcessing = true;
    const targetFolder = '/';
    let successCount = 0;
    let errorCount = 0;

    for (const docId of selectedDocuments) {
      try {
        const response = await callBackend_('move_document', {
          user_id: userId,
          doc_id: docId,
          folder: targetFolder,
        });

        if (response?.ok) {
          successCount++;
          documents = documents.map((doc) => doc.id === docId ? { ...doc, folder: targetFolder } : doc);
        } else {
          errorCount++;
        }
      } catch (err) {
        console.error('Remove from folder error:', docId, err);
        errorCount++;
      }
    }

    selectedDocuments.clear();
    selectedDocuments = selectedDocuments;
    selectAllChecked = false;
    isBulkMoveProcessing = false;

    if (errorCount === 0) {
      showActionMessage_(`Removed ${successCount} document${successCount !== 1 ? 's' : ''} from folder.`);
    } else {
      showActionMessage_(`Removed ${successCount}. Failed to remove ${errorCount}.`, 'error');
    }
  }

  async function duplicateBulkDocuments() {
    if (selectedDocuments.size === 0 || isBulkDuplicateProcessing) return;
    isBulkDuplicateProcessing = true;

    let successCount = 0;
    let errorCount = 0;

    for (const docId of selectedDocuments) {
      try {
        const response = await callBackend_('duplicate_document', {
          user_id: userId,
          doc_id: docId
        });

        if (response?.ok) {
          successCount++;
        } else {
          errorCount++;
        }
      } catch (err) {
        console.error('Bulk duplicate error:', docId, err);
        errorCount++;
      }
    }

    await loadDocuments_();
    isBulkDuplicateProcessing = false;
    if (errorCount === 0) {
      showActionMessage_(`Duplicated ${successCount} document${successCount !== 1 ? 's' : ''}.`);
    } else {
      showActionMessage_(`Duplicated ${successCount}. Failed to duplicate ${errorCount}.`, 'error');
    }
  }

  function openRenameFolderModal(folderName) {
    folderToRename = folderName;
    renameFolderInputValue = folderName;
    showRenameFolderModal = true;
  }

  function renameFolder() {
    if (!renameFolderInputValue.trim() || renameFolderInputValue === folderToRename) {
      showRenameFolderModal = false;
      return;
    }

    // Update folder name in folderStructure
    const folderIndex = folderStructure.root.subfolders.findIndex(
      f => {
        const fPath = typeof f === 'string' ? f : f.path;
        return fPath === folderToRename;
      }
    );
    
    if (folderIndex !== -1) {
      const oldFolder = folderStructure.root.subfolders[folderIndex];
      const oldPath = typeof oldFolder === 'string' ? oldFolder : oldFolder.path;
      
      // Create new folder object with updated name
      const newFolderObj = typeof oldFolder === 'string' 
        ? renameFolderInputValue
        : {
            ...oldFolder,
            name: renameFolderInputValue,
            path: normalizeFolderPath_(renameFolderInputValue),
          };
      
      folderStructure.root.subfolders[folderIndex] = newFolderObj;
      
      // Update all documents that have the old folder path
      const newPath = typeof newFolderObj === 'string' 
        ? newFolderObj
        : newFolderObj.path;
      
      documents = documents.map(doc => 
        normalizeFolderPath_(doc.folder) === oldPath ? { ...doc, folder: newPath } : doc
      );
      
      // If the renamed folder was selected, update currentFolder
      if (currentFolder === oldPath) {
        currentFolder = newPath;
      }

      folderStructure.root.subfolders = [...folderStructure.root.subfolders];
    }

    showRenameFolderModal = false;
    folderToRename = null;
    renameFolderInputValue = '';
  }

  async function deleteFolder(folderPath) {
    const normalizedPath = normalizeFolderPath_(folderPath);
    isDeletingFolder = true;

    // Remove folder, nested folders, and their documents optimistically.
    folderStructure.root.subfolders = folderStructure.root.subfolders.filter(
      f => {
        const fPath = typeof f === 'string' ? f : f.path;
        return !isFolderPathInTree_(fPath, normalizedPath);
      }
    );
    documents = documents.filter(doc => !isFolderPathInTree_(doc.folder, normalizedPath));

    // Reset currentFolder if it was the deleted folder
    if (isFolderPathInTree_(currentFolder, normalizedPath)) {
      currentFolder = '/';
    }

    try {
      const response = await callBackend_('delete_folder', {
        user_id: userId,
        folder_path: normalizedPath
      });

      const folderStillExistsLocally = folderStructure.root.subfolders.some((f) => {
        const fPath = typeof f === 'string' ? f : f.path;
        return isFolderPathInTree_(fPath, normalizedPath);
      });
      const docsStillExistLocally = documents.some((doc) => isFolderPathInTree_(doc.folder, normalizedPath));
      const locallyDeleted = !folderStillExistsLocally && !docsStillExistLocally;

      if (response?.ok || locallyDeleted) {
        showActionMessage_('Folder deleted successfully.');
        showDeleteFolderConfirm = false;
        folderToDelete = null;
        documentsInFolderToDelete = [];
        documentActionMap = {};
        return;
      }

      console.warn('Delete folder returned non-ok but folder still exists locally:', response);
      showActionMessage_('Error deleting folder: ' + (response?.error || 'Unknown error'), 'error');
      loadFolders_();
      loadDocuments_();
    } catch (err) {
      const folderStillExistsLocally = folderStructure.root.subfolders.some((f) => {
        const fPath = typeof f === 'string' ? f : f.path;
        return isFolderPathInTree_(fPath, normalizedPath);
      });
      const docsStillExistLocally = documents.some((doc) => isFolderPathInTree_(doc.folder, normalizedPath));
      const locallyDeleted = !folderStillExistsLocally && !docsStillExistLocally;

      if (locallyDeleted) {
        showActionMessage_('Folder deleted successfully.');
        showDeleteFolderConfirm = false;
        folderToDelete = null;
        documentsInFolderToDelete = [];
        documentActionMap = {};
        return;
      }

      console.error('Delete folder error:', err);
      showActionMessage_('Error deleting folder. Please try again.', 'error');
      loadFolders_();
      loadDocuments_();
    } finally {
      isDeletingFolder = false;
    }
  }

  function processFolderAction(folderPath, action) {
    const normalizedPath = normalizeFolderPath_(folderPath);
    const folderName = getFolderNameFromPath_(normalizedPath);
    
    if (action === 'delete') {
      deleteFolder(folderPath);
    } else if (action === 'rename') {
      showDeleteFolderConfirm = false;
      folderToDelete = null;
      documentsInFolderToDelete = [];
      documentActionMap = {};
      folderAction = 'delete'; // Reset for next time
      folderToRename = normalizedPath;
      renameFolderInputValue = folderName;
      showRenameFolderModal = true;
    } else if (action === 'move') {
      showActionMessage_('Move folder feature coming soon. For now, you can rename the folder or duplicate it.', 'info');
    } else if (action === 'duplicate') {
      isDeletingFolder = true;
      const duplicatedFolderName = folderName + ' (Copy)';
      const newFolderPath = '/' + duplicatedFolderName;

      // Duplicate all documents in this folder
      const docsInFolder = documents.filter(d => d.folder === normalizedPath);
      const duplicatedDocs = docsInFolder.map(doc => ({
        ...doc,
        id: 'doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        name: doc.name,
        folder: newFolderPath,
        created_at: new Date().toISOString()
      }));

      documents = [...documents, ...duplicatedDocs];

      // Add folder to structure
      if (!folderStructure.root.subfolders) {
        folderStructure.root.subfolders = [];
      }
      folderStructure.root.subfolders = [
        ...folderStructure.root.subfolders,
        {
          path: newFolderPath,
          name: duplicatedFolderName,
          createdBy: userId,
          createdByName: currentUser?.full_name || 'Unknown'
        }
      ];

      callBackend_('duplicate_folder', {
        user_id: userId,
        folder_path: normalizedPath,
        new_folder_path: newFolderPath,
        document_ids: docsInFolder.map(d => d.id)
      }).then(response => {
        if (response?.ok) {
          showActionMessage_('Folder duplicated successfully.');
        } else {
          showActionMessage_('Error duplicating folder: ' + (response?.error || 'Unknown error'), 'error');
        }
      }).catch(err => {
        console.error('Duplicate folder error:', err);
        showActionMessage_('Error duplicating folder. Please try again.', 'error');
      }).finally(() => {
        isDeletingFolder = false;
        showDeleteFolderConfirm = false;
        folderToDelete = null;
        documentsInFolderToDelete = [];
        documentActionMap = {};
        folderAction = 'delete'; // Reset for next time
      });
    }
  }

  function duplicateFolderAction_(folderPath) {
    const normalizedPath = normalizeFolderPath_(folderPath);
    const folderName = getFolderNameFromPath_(normalizedPath);
    isDeleteFoldersProcessing = true;
    
    const duplicatedFolderName = folderName + ' (Copy)';
    const newFolderPath = '/' + duplicatedFolderName;

    // Duplicate all documents in this folder
    const docsInFolder = documents.filter(d => d.folder === normalizedPath);
    const duplicatedDocs = docsInFolder.map(doc => ({
      ...doc,
      id: 'doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      name: doc.name,
      folder: newFolderPath,
      created_at: new Date().toISOString()
    }));

    documents = [...documents, ...duplicatedDocs];

    // Add folder to structure
    if (!folderStructure.root.subfolders) {
      folderStructure.root.subfolders = [];
    }
    folderStructure.root.subfolders = [
      ...folderStructure.root.subfolders,
      {
        path: newFolderPath,
        name: duplicatedFolderName,
        createdBy: userId,
        createdByName: currentUser?.full_name || 'Unknown'
      }
    ];

    callBackend_('duplicate_folder', {
      user_id: userId,
      folder_path: normalizedPath,
      new_folder_path: newFolderPath,
      document_ids: docsInFolder.map(d => d.id)
    }).then(response => {
      if (response?.ok) {
        showActionMessage_('Folder duplicated successfully.');
      } else {
        showActionMessage_('Error duplicating folder: ' + (response?.error || 'Unknown error'), 'error');
      }
    }).catch(err => {
      console.error('Duplicate folder error:', err);
      showActionMessage_('Error duplicating folder. Please try again.', 'error');
    }).finally(() => {
      isDeleteFoldersProcessing = false;
      selectedFolders.clear();
      showFolderBulkActions = false;
    });
  }


  function canDeleteFolder_(folder) {
    // Supervisors can delete any folder
    if (isSupervisor) {
      return true;
    }
    
    // Interns can only delete folders they created
    const creatorId = typeof folder === 'string' ? '' : (folder.createdBy || folder.ownerUserId || '');
    return creatorId === userId;
  }

  function canRenameFolder_(folder) {
    if (isSupervisor) return true;
    const ownerId = typeof folder === 'string' ? '' : String(folder.createdBy || folder.ownerUserId || '').trim();
    return Boolean(ownerId) && ownerId === String(userId || '').trim();
  }

  function toggleFolderSelection(folderPath) {
    if (!canDeleteFolder_(folderStructure.root.subfolders.find(f => {
      const fPath = typeof f === 'string' ? f : f.path;
      return fPath === folderPath;
    }))) {
      showActionMessage_('You do not have permission to delete this folder.', 'error');
      return;
    }

    if (selectedFolders.has(folderPath)) {
      selectedFolders.delete(folderPath);
    } else {
      selectedFolders.add(folderPath);
    }
    selectedFolders = selectedFolders; // trigger reactivity
    updateSelectAllFoldersStatus();
  }

  function toggleSelectAllFolders() {
    if (selectAllFoldersChecked) {
      // Deselect all
      selectedFolders.clear();
      selectAllFoldersChecked = false;
    } else {
      // Select all folders that the user can delete
      currentChildFolders.forEach(folder => {
        const folderPath = typeof folder === 'string' ? folder : folder.path;
        if (canDeleteFolder_(folder)) {
          selectedFolders.add(folderPath);
        }
      });
      selectAllFoldersChecked = true;
    }
    selectedFolders = selectedFolders; // trigger reactivity
  }

  function updateSelectAllFoldersStatus() {
    const deletableFolders = currentChildFolders.filter(f => canDeleteFolder_(f));
    if (deletableFolders.length === 0) {
      selectAllFoldersChecked = false;
    } else {
      const deletablePaths = deletableFolders.map(f => typeof f === 'string' ? f : f.path);
      selectAllFoldersChecked = deletablePaths.every(path => selectedFolders.has(path));
    }
  }

  function toggleFolderBulkActions() {
    showFolderBulkActions = !showFolderBulkActions;
    if (!showFolderBulkActions) {
      selectedFolders.clear();
      selectAllFoldersChecked = false;
    }
  }

  async function deleteBulkFolders() {
    if (selectedFolders.size === 0) return;
    showDeleteFoldersConfirm = true;
  }

  async function confirmBulkDeleteFolders() {
    if (selectedFolders.size === 0) return;
    isDeleteFoldersProcessing = true;

    try {
      let successCount = 0;
      let errorCount = 0;

      for (const folderPath of selectedFolders) {
        try {
          // Call backend to delete the folder
          const response = await callBackend_('delete_folder', {
            user_id: userId,
            folder_path: folderPath
          });

          if (response?.ok) {
            // Remove all documents in this folder tree.
            documents = documents.filter(doc => !isFolderPathInTree_(doc.folder, folderPath));

            // Remove folder and nested folders from structure.
            folderStructure.root.subfolders = folderStructure.root.subfolders.filter(
              f => {
                const fPath = typeof f === 'string' ? f : f.path;
                return !isFolderPathInTree_(fPath, folderPath);
              }
            );

            successCount++;

            // Reset currentFolder if it was a deleted folder
            if (isFolderPathInTree_(currentFolder, folderPath)) {
              currentFolder = '/';
            }
          } else {
            console.error('Delete failed for folder:', folderPath, response);
            errorCount++;
          }
        } catch (err) {
          console.error('Error deleting folder:', folderPath, err);
          errorCount++;
        }
      }

      // Clear selection
      selectedFolders.clear();
      selectAllFoldersChecked = false;
      selectedFolders = selectedFolders; // trigger reactivity
      showDeleteFoldersConfirm = false;
      isDeleteFoldersProcessing = false;

      if (errorCount === 0) {
        showActionMessage_(`Successfully deleted ${successCount} folder${successCount !== 1 ? 's' : ''}.`);
      } else {
        showActionMessage_(`Deleted ${successCount} folder${successCount !== 1 ? 's' : ''}. Failed to delete ${errorCount}.`, 'error');
      }
    } catch (err) {
      console.error('Bulk delete folders error:', err);
      showActionMessage_('Error deleting folders', 'error');
      showDeleteFoldersConfirm = false;
      isDeleteFoldersProcessing = false;
    }
  }

  function formatDate(dateStr) {
    if (!dateStr) return 'â€”';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return 'â€”';
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function getAccessBadgeColor(level) {
    switch(level) {
      case 'private': return '#ef4444';
      case 'shared': return '#3b82f6';
      case 'restricted': return '#f59e0b';
      default: return '#6b7280';
    }
  }

  onMount(async () => {
    // Resolve authenticated user id first to keep document records consistent.
    try {
      const authUser = authApi.getCurrentUser() || (await authApi.restoreAuthSession());
      currentUser = authUser;
      userId = resolveCurrentUserId_();
      
      if (!userId) {
        console.error('Unable to resolve authenticated user id for documents.');
        isLoading = false;
        return;
      }

      isSupervisor = currentUser?.role === 'Supervisor';

      // Load group-based data in a single optimized bootstrap trip
      await loadInitialData_();
      loadShareCandidates_();
    } catch (err) {
      console.error('Error initializing documents:', err);
      showActionMessage_('Unable to load documents. Please refresh.', 'error');
    }
  });
</script>

<section class="page-shell">
  <div class="topbar">
    <div class="page-title-group">
      <div class="page-title">
      </div>
    </div>
    <div class="action-bar">
    </div>
  </div>

  <div class="documents-container">
    {#if actionMessage}
      <div class={`action-message ${actionMessageType === 'error' ? 'action-message-error' : 'action-message-success'}`}>
        <span>{actionMessage}</span>
      </div>
    {/if}

    {#if isLoading}
      <div class="stats-row docs-skeleton-stats" aria-hidden="true">
        {#each [1, 2, 3, 4] as _}
          <div class="stat-card docs-skeleton-stat-card">
            <div class="stat-head">
              <div class="skeleton docs-skeleton-label"></div>
              <div class="skeleton docs-skeleton-icon"></div>
            </div>
            <div class="skeleton docs-skeleton-value"></div>
            <div class="skeleton docs-skeleton-sub"></div>
          </div>
        {/each}
      </div>

      <div class="bottom-area docs-skeleton-area" aria-hidden="true">
        <div>
          <div class="search-filter-bar">
            <div class="search-wrap">
              <Search size={15} />
              <div class="skeleton docs-skeleton-search"></div>
            </div>
          </div>

          <div class="docs-panel docs-skeleton-panel">
            <div class="docs-panel-header">
              <div class="filter-tabs docs-skeleton-tabs">
                {#each [1, 2, 3, 4] as _}
                  <div class="skeleton docs-skeleton-tab"></div>
                {/each}
              </div>
              <div class="header-controls docs-skeleton-controls">
                <div class="skeleton docs-skeleton-count"></div>
                <div class="skeleton docs-skeleton-button"></div>
                <div class="skeleton docs-skeleton-button docs-skeleton-button-primary"></div>
                <div class="skeleton docs-skeleton-select"></div>
              </div>
            </div>

            <div class="sort-bar docs-skeleton-sort">
              <div class="skeleton docs-skeleton-sort-label"></div>
              <div class="skeleton docs-skeleton-sort-btn"></div>
              <div class="skeleton docs-skeleton-sort-btn"></div>
              <div class="skeleton docs-skeleton-sort-btn"></div>
            </div>

            <div class="docs-skeleton-list">
              {#each [1, 2, 3] as _}
                <div class="docs-skeleton-row">
                  <div class="docs-skeleton-row-main">
                    <div class="skeleton docs-skeleton-file-icon"></div>
                    <div class="docs-skeleton-file-text">
                      <div class="skeleton docs-skeleton-file-name"></div>
                      <div class="skeleton docs-skeleton-uploader"></div>
                    </div>
                  </div>
                  <div class="skeleton docs-skeleton-badge"></div>
                  <div class="skeleton docs-skeleton-size"></div>
                  <div class="skeleton docs-skeleton-date"></div>
                  <div class="docs-skeleton-actions">
                    <div class="skeleton docs-skeleton-action"></div>
                    <div class="skeleton docs-skeleton-action"></div>
                    <div class="skeleton docs-skeleton-action"></div>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        </div>
      </div>
    {:else}
      <div class="stats-row">
        <div class="stat-card stat-card--folders">
          <div class="stat-head">
            <div class="stat-label">Group Folders</div>
            <div class="stat-icon" aria-hidden="true">
              <FolderOpen size={16} />
            </div>
          </div>
          <div class="stat-value">{folderStructure.root.subfolders.length}</div>
          <div class="stat-sub">Organized categories</div>
        </div>
        <div class="stat-card stat-card--documents">
          <div class="stat-head">
            <div class="stat-label">Group Documents</div>
            <div class="stat-icon" aria-hidden="true">
              <FileText size={16} />
            </div>
          </div>
          <div class="stat-value">{documents.filter((doc) => !doc.isLink).length}</div>
          <div class="stat-sub">Files uploaded</div>
        </div>
        <div class="stat-card stat-card--links">
          <div class="stat-head">
            <div class="stat-label">Group Links</div>
            <div class="stat-icon" aria-hidden="true">
              <Link2 size={16} />
            </div>
          </div>
          <div class="stat-value">{documents.filter((doc) => doc.isLink).length}</div>
          <div class="stat-sub">External references</div>
        </div>
        <div class="stat-card stat-card--total">
          <div class="stat-head">
            <div class="stat-label">Total Items</div>
            <div class="stat-icon" aria-hidden="true">
              <Files size={16} />
            </div>
          </div>
          <div class="stat-value">{documents.length}</div>
          <div class="stat-sub">Across all group folders</div>
        </div>
      </div>

      <div class="bottom-area">
        <div>
          <div class="search-filter-bar">
            <div class="search-wrap">
              <Search size={15} />
              <input class="search-input" type="text" placeholder="Search documents..." bind:value={searchQuery} />
            </div>
          </div>

          <div class="docs-panel">
            <div class="docs-panel-header">
              <div class="filter-tabs">
                <button 
                  class="filter-tab" 
                  class:active={documentFilter === 'all'}
                  on:click={() => {
                    documentFilter = 'all';
                    closeDocumentFolder_();
                  }}
                >
                  All Documents
                </button>
                <button 
                  class="filter-tab" 
                  class:active={documentFilter === 'my'}
                  on:click={() => {
                    documentFilter = 'my';
                    closeDocumentFolder_();
                  }}
                >
                  My Documents
                </button>
                <button 
                  class="filter-tab" 
                  class:active={documentFilter === 'shared'}
                  on:click={() => {
                    documentFilter = 'shared';
                    closeDocumentFolder_();
                  }}
                >
                  Shared with Me
                </button>
                <button 
                  class="filter-tab" 
                  class:active={documentFilter === 'folders'}
                  on:click={() => {
                    documentFilter = 'folders';
                    closeDocumentFolder_();
                  }}
                >
                  Folders
                </button>
              </div>
              <div class="header-controls">
                {#if showBulkActions}
                  <span class="selection-info">{selectedDocuments.size} selected</span>
                  <button class="btn btn-secondary" on:click={toggleSelectAll} title="Select all visible documents">
                    {selectAllChecked ? 'Deselect All' : 'Select All'}
                  </button>
                  {#if selectedDocuments.size > 0}
                    {#if documentFilter === 'folders' && isFolderOpen && currentFolder !== '/'}
                      <button class="btn btn-secondary" on:click={removeSelectedFromCurrentFolder} title="Remove selected documents from this folder">
                        <FolderOpen size={14} />
                        <span>Remove from Folder</span>
                      </button>
                    {/if}
                    <button class="btn btn-secondary" on:click={moveBulkDocuments} title="Move selected documents">
                      <FolderOpen size={14} />
                      <span>Move</span>
                    </button>
                    <button class="btn btn-secondary" on:click={duplicateBulkDocuments} title="Duplicate selected documents" disabled={isBulkDuplicateProcessing}>
                      {#if isBulkDuplicateProcessing}
                        <span class="spinning-icon"><Loader2 size={14} /></span>
                        <span>Duplicating...</span>
                      {:else}
                        <Copy size={14} />
                        <span>Duplicate</span>
                      {/if}
                    </button>
                    <button class="btn btn-ghost delete-bulk-btn" on:click={deleteBulkDocuments} title="Delete selected documents">
                      <Trash2 size={14} />
                      <span>Delete ({selectedDocuments.size})</span>
                    </button>
                  {/if}
                  <button 
                    class="select-btn cancel-btn"
                    on:click={toggleBulkActions}
                  >
                    Cancel
                  </button>
                {:else if documentFilter === 'folders' && showFolderBulkActions}
                  <span class="selection-info">{selectedFolders.size} selected</span>
                  <button 
                    class="btn btn-secondary"
                    on:click={toggleSelectAllFolders}
                    title="Select/deselect all deletable folders"
                  >
                    {selectAllFoldersChecked ? 'Deselect All' : 'Select All'}
                  </button>
                  <button 
                    class="select-btn cancel-btn"
                    on:click={toggleFolderBulkActions}
                  >
                    Cancel
                  </button>
                {:else}
                  <span class="docs-count">{documentFilter === 'folders' ? currentChildFolders.length : (isFolderOpen ? folderDocuments.length : filteredDocuments.length)} items</span>
                  <button class="btn btn-ghost" on:click={() => (showCreateFolderModal = true)}>
                    <Folder size={14} />
                    <span>Create Folder</span>
                  </button>
                  <button class="btn btn-primary" on:click={openUploadModal_}>
                    <Upload size={14} />
                    <span>Upload Document</span>
                  </button>
                  <button 
                    class="select-btn"
                    on:click={() => (documentFilter === 'folders' && !isFolderOpen) ? toggleFolderBulkActions() : toggleBulkActions()}
                  >
                    Select
                  </button>
                {/if}
              </div>
            </div>

            {#if documentFilter === 'folders' && !isFolderOpen}
              <div class="folder-table-wrapper">
                <!-- Folders List -->
                <table class="folders-table">
                  <thead>
                    <tr>
                      <th class="col-checkbox"></th>
                      <th>Name</th>
                      <th class="col-creator-header">Created By</th>
                      <th class="col-files-header">Files</th>
                      <th class="col-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each currentChildFolders as folder (typeof folder === 'string' ? folder : folder.path)}
                      {@const folderPath = typeof folder === 'string' ? folder : folder.path}
                      {@const creatorName = typeof folder === 'string' ? '–' : (folder.createdByName || folder.createdBy || '–')}
                      {@const folderDocs = documents.filter(doc => normalizeFolderPath_(doc.folder) === folderPath)}
                      {@const canDelete = canDeleteFolder_(folder)}
                      {@const canRename = canRenameFolder_(folder)}
                      <tr 
                        class="table-row"
                        class:active={selectedFolderInTab === folderPath}
                        on:click={() => {
                          if (showFolderBulkActions) {
                            toggleFolderSelection(folderPath);
                          } else {
                            openDocumentFolder_(folderPath);
                          }
                        }}
                        style="cursor: pointer;"
                      >
                        <td class="col-checkbox" style="visibility: {showFolderBulkActions ? 'visible' : 'hidden'};">
                          {#if showFolderBulkActions}
                            <input 
                              type="checkbox" 
                              checked={selectedFolders.has(folderPath)}
                              disabled={!canDelete}
                              on:change={() => toggleFolderSelection(folderPath)}
                              on:click={(e) => e.stopPropagation()}
                            />
                          {/if}
                        </td>
                        <td class="col-name">
                          <div class="file-info">
                            <div class="file-icon">
                              <Folder size={16} />
                            </div>
                            <span class="file-name">{getFolderNameFromPath_(folderPath)}</span>
                          </div>
                        </td>
                        <td class="col-creator">
                          <span class="creator-name">{creatorName}</span>
                        </td>
                        <td class="col-files">
                          <span class="files-count">{folderDocs.length}</span>
                        </td>
                        <td class="col-actions">
                          {#if canRename || canDelete}
                            {#if canRename}
                              <button 
                                class="icon-btn rename-btn"
                                title="Rename folder"
                                on:click={(e) => {
                                  e.stopPropagation();
                                  folderToRename = folderPath;
                                  renameFolderInputValue = getFolderNameFromPath_(folderPath);
                                  showRenameFolderModal = true;
                                }}
                              >
                                <Pencil size={14} />
                              </button>
                            {/if}
                            {#if canDelete}
                              <button 
                                class="icon-btn delete-btn"
                                title="Delete folder"
                                on:click={(e) => {
                                  e.stopPropagation();
                                  folderToDelete = folder;
                                  showDeleteFolderConfirm = true;
                                }}
                              >
                                <Trash2 size={14} />
                              </button>
                            {/if}
                          {:else}
                            <span class="permission-denied" title="You don't have permission to rename or delete this folder">
                              🔒
                            </span>
                          {/if}
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}

            {#if filteredDocuments.length > 0 && (documentFilter !== 'folders' || isFolderOpen)}
              <div class="table-wrapper">
                <table class="documents-table">
                  <thead>
                    <tr>
                      {#if showBulkActions}
                        <th class="col-checkbox"></th>
                      {/if}
                      <th class="col-name-header">Name</th>
                      <th class="col-uploader-header">Uploaded By</th>
                      <th class="col-folder-header">Folder</th>
                      <th class="col-type-header">Type</th>
                      <th class="col-size-header">Size</th>
                      <th class="col-date-header">Uploaded</th>
                      <th class="col-actions-header">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each filteredDocuments as doc (doc.id)}
                      {@const canDeleteDoc = canDeleteDocument_(doc)}
                      {@const canManageShareDoc = canManageShare_(doc)}
                      <tr 
                        class="table-row" 
                        class:row-selected={showBulkActions && canDeleteDoc && selectedDocuments.has(doc.id)}
                        on:click={() => {
                          if (showBulkActions) {
                            if (canDeleteDoc) {
                              toggleDocumentSelection(doc);
                            } else {
                              showActionMessage_('You do not have permission to delete this document.', 'error');
                            }
                          } else {
                            openDocument(doc, null);
                          }
                        }}
                      >
                        {#if showBulkActions}
                          <td class="col-checkbox">
                            <input
                              type="checkbox"
                              checked={selectedDocuments.has(doc.id)}
                              disabled={!canDeleteDoc}
                              on:change={() => toggleDocumentSelection(doc)}
                              on:click={(e) => e.stopPropagation()}
                              class="table-checkbox"
                            />
                          </td>
                        {/if}
                        <td class="col-name">
                          <div class="file-info">
                            <div class="file-icon">
                              {#if doc.isLink}
                                <Link2 size={16} />
                              {:else}
                                <FileText size={16} />
                              {/if}
                            </div>
                            <button 
                              type="button" 
                              class="file-name-btn" 
                              title="Open document" 
                              on:click={(e) => {
                                e.stopPropagation();
                                openDocument(doc, e);
                              }}
                            >
                              <span class="file-name">{doc.name}</span>
                            </button>
                          </div>
                        </td>
                        <td class="col-uploader">
                          <span class="uploader-name">{doc.created_by_name || 'â€”'}</span>
                        </td>
                        <td class="col-folder">
                          <span class="folder-path-badge">{doc.folder || '/'}</span>
                        </td>
                        <td class="col-type">
                          <span class="type-badge">{doc.isLink ? 'Link' : 'File'}</span>
                        </td>
                        <td class="col-size">
                          {#if doc.size}
                            {doc.size}
                          {:else}
                            â€”
                          {/if}
                        </td>
                        <td class="col-date">{formatDate(doc.uploadedDate)}</td>
                        <td class="col-actions">
                          <div class="action-buttons">
                            <button
                              type="button"
                              class="icon-btn"
                              title="View/Download"
                              on:click={(e) => {
                                e.stopPropagation();
                                openDocument(doc, e);
                              }}
                            >
                              {#if doc.isLink}
                                <Eye size={14} />
                              {:else}
                                <Download size={14} />
                              {/if}
                            </button>
                            {#if canManageShareDoc}
                              <button 
                                class="icon-btn share-btn" 
                                title="Manage visibility" 
                                on:click={(e) => {
                                  e.stopPropagation();
                                  openShareModal(doc);
                                }}
                              >
                                <Share2 size={14} />
                              </button>
                            {:else}
                              <button
                                type="button"
                                class="icon-btn"
                                title="Only the document owner or supervisor can manage visibility"
                                disabled
                              >
                                <Lock size={14} />
                              </button>
                            {/if}
                            {#if canDeleteDoc}
                              <button 
                                class="icon-btn delete-btn" 
                                title="Delete" 
                                on:click={(e) => {
                                  e.stopPropagation();
                                  openDeleteConfirm(doc);
                                }}
                              >
                                <Trash2 size={14} />
                              </button>
                            {/if}
                          </div>
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {:else if (documentFilter !== 'folders' || isFolderOpen) && filteredDocuments.length === 0}
              <div class="empty-state">
                <div class="empty-icon-wrap">
                  <FileText size={28} />
                </div>
                <div class="empty-title">{isFolderOpen ? 'This folder is empty' : 'No documents yet'}</div>
                <div class="empty-sub">Upload a document or add a link to get started</div>
              </div>
            {/if}

            {#if isFolderOpen}
              <div class="folder-open-header">
                <button type="button" class="folder-back-btn" on:click={closeDocumentFolder_} title="Back to folder list">
                  <ChevronRight size={16} style="transform: rotate(180deg);" />
                  <span>Back</span>
                </button>
                <ChevronRight size={14} />
                <div class="folder-open-title">
                  <Folder size={16} />
                  <span>{currentFolderName}</span>
                </div>
              </div>
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </div>

  <!-- Upload Modal -->
  {#if showUploadModal}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="modal-overlay" on:click={closeUploadModal}>
      <div class="modal modal-upload" on:click={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <div class="modal-title-stack">
            <h2>Upload Document</h2>
            <p>Choose a folder, then upload your file.</p>
          </div>
          <button class="close-btn" on:click={closeUploadModal}>×</button>
        </div>

        <div class="modal-body modal-upload-body">
          <!-- Folder Selection with Search -->
          <div class="form-group upload-folder-section">
            <span class="label-heading">Select Folder (Optional)</span>
            
            <!-- Search Box -->
            {#if folderStructure.root.subfolders.length > 4}
              <div class="folder-search-wrapper">
                <Search size={16} class="search-icon" />
                <input
                  type="text"
                  class="folder-search-input"
                  placeholder="Search folders..."
                  bind:value={folderSearchQuery}
                />
              </div>
            {/if}
            
            <!-- Folder Grid -->
            <div class="folder-grid">
              <!-- None Option -->
              <button
                type="button"
                class="folder-card"
                class:active={uploadToFolder === '/'}
                on:click|stopPropagation={() => (uploadToFolder = '/')}
                title="Upload without selecting a folder"
              >
                <X size={20} />
                <span class="folder-name">None</span>
              </button>

              {#each normalizedFolders.filter(f => f.toLowerCase().includes(folderSearchQuery.toLowerCase())) as folderPath (folderPath)}
                <button
                  type="button"
                  class="folder-card"
                  class:active={uploadToFolder === folderPath}
                  on:click|stopPropagation={() => (uploadToFolder = folderPath)}
                  title={folderPath}
                >
                  <Folder size={20} />
                  <span class="folder-name">{folderPath.substring(1)}</span>
                </button>
              {/each}
            </div>

            {#if normalizedFolders.filter(f => f.toLowerCase().includes(folderSearchQuery.toLowerCase())).length === 0 && normalizedFolders.length > 0}
              <div class="no-folders-message">No folders match your search</div>
            {/if}
          </div>

          <!-- Upload Area -->
          <div class="upload-area upload-dropzone">
            <input
              type="file"
              id="fileInput"
              hidden
              on:change={handleFileUpload}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.jpg,.png"
            />
            <label for="fileInput" class="upload-label">
              <Upload size={40} />
              <p>Drag and drop your file here</p>
              <span>or click to browse</span>
              <p class="file-hint">PDF, Word, Excel, PowerPoint (Max 50MB)</p>
            </label>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" on:click={closeUploadModal}>Close</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Upload Preview Modal -->
  {#if showUploadPreview && pendingFilePreview}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="modal-overlay" on:click={() => !isUploading && cancelUpload()}>
      <div class="modal modal-create-folder" on:click={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>Review Document</h2>
          <button class="close-btn" on:click={() => cancelUpload()} disabled={isUploading}>×</button>
        </div>

        <div class="modal-body">
            <div class="preview-details preview-details--solo">
            <div class="preview-section">
              <label for="preview-name">File Name</label>
              <p class="preview-value" id="preview-name">{pendingFilePreview.name}</p>
            </div>

            <div class="preview-section">
              <label for="preview-size">File Size</label>
              <p class="preview-value" id="preview-size">{pendingFilePreview.size}</p>
            </div>

            <div class="preview-section">
              <label for="preview-folder">Upload Folder</label>
              <p class="preview-value" id="preview-folder">
                {pendingFilePreview.folder === '/' ? 'No Folder' : pendingFilePreview.folder.substring(1)}
              </p>
            </div>
          </div>
        </div>

        <div class="modal-footer modal-footer-centered">
          <button class="btn btn-secondary" on:click={() => cancelUpload()} disabled={isUploading}>Delete</button>
          <button class="btn btn-primary" on:click={() => confirmUpload()} disabled={isUploading}>
            {#if isUploading}
              <span class="spinning-icon" style="margin-right: 0.4rem; display: inline-flex;"><Loader2 size={16} /></span>
              <span>Uploading...</span>
            {:else}
              <Check size={18} />
              <span>Save Document</span>
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Link Modal -->
  {#if showLinkModal}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="modal-overlay" on:click={() => (showLinkModal = false)}>
      <div class="modal" on:click={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>Add Link</h2>
          <button class="close-btn" on:click={() => (showLinkModal = false)}>×</button>
        </div>

        <div class="modal-body">
          <!-- Folder Selection Tabs -->
          <div class="form-group">
            <span class="label-heading">Select Folder (Optional)</span>
            <div class="folder-tabs">
              <!-- None Option -->
              <button
                type="button"
                class="folder-tab"
                class:active={uploadToFolder === '/'}
                on:click|stopPropagation={() => (uploadToFolder = '/')}
              >
                <X size={16} />
                <span>None</span>
              </button>

              {#each normalizedFolders as folderPath (folderPath)}
                <button
                  type="button"
                  class="folder-tab"
                  class:active={uploadToFolder === folderPath}
                  on:click|stopPropagation={() => (uploadToFolder = folderPath)}
                >
                  <Folder size={16} />
                  <span>{folderPath.substring(1)}</span>
                </button>
              {/each}
            </div>
            <div class="selected-folder-text">
              Selected: {uploadToFolder === '/' ? 'No Folder' : uploadToFolder.substring(1)}
            </div>
          </div>

          <div class="form-group">
            <label for="linkName">Link Name</label>
            <input
              id="linkName"
              type="text"
              placeholder="e.g., Meeting Recording - Week 1"
              bind:value={newLinkName}
            />
          </div>

          <div class="form-group">
            <label for="linkUrl">URL</label>
            <input
              id="linkUrl"
              type="url"
              placeholder="https://..."
              bind:value={newLinkUrl}
            />
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" on:click={() => (showLinkModal = false)}>Cancel</button>
          <button class="btn btn-primary" on:click={addLink} disabled={!newLinkName.trim() || !newLinkUrl.trim() || isAddingLink}>
            {#if isAddingLink}
              <span class="spinning-icon" style="margin-right: 0.4rem; display: inline-flex;"><Loader2 size={16} /></span>
              <span>Adding...</span>
            {:else}
              <Plus size={18} />
              <span>Add Link</span>
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Create Folder Modal -->
  {#if showCreateFolderModal}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="modal-overlay" on:click={() => !isCreatingFolder && (showCreateFolderModal = false)}>
      <div class="modal modal-folder-create" on:click={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <div class="modal-title-stack">
            <h2>Create Folder</h2>
            <p>Create a folder inside the current directory.</p>
          </div>
          <button class="close-btn" on:click={() => (showCreateFolderModal = false)} disabled={isCreatingFolder}>×</button>
        </div>

        <div class="modal-body modal-folder-create-body">
          <div class="form-group folder-create-form-group">
            <label for="folderName">Folder Name</label>
            <input
              id="folderName"
              type="text"
              placeholder="e.g., Important Documents"
              bind:value={newFolderName}
              disabled={isCreatingFolder}
            />
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" on:click={() => (showCreateFolderModal = false)} disabled={isCreatingFolder}>Cancel</button>
          <button class="btn btn-primary" on:click={async () => {
            const folderName = String(newFolderName || '').trim();
            if (!folderName || isCreatingFolder) {
              return;
            }

            try {
              isCreatingFolder = true;
              
              // Extract user display name - use full_name first, fallback to email
              let displayName = currentUser?.full_name || currentUser?.email || userId;
              
              const response = await callBackend_('create_folder', {
                user_id: userId,
                folder_name: folderName,
                parent_path: currentFolder,
                created_by: userId,
                created_by_name: displayName,
              });

              if (!response?.ok) {
                console.error('Folder creation failed:', response?.error);
                showActionMessage_('Unable to create folder: ' + (response?.error || 'Unknown error'), 'error');
                return;
              }

              // Reload folders from the database to ensure persistence
              await loadInitialData_();

              uploadToFolder = currentFolder !== '/' ? currentFolder : '/';
              documentFilter = 'folders';
              currentFolder = '/'; // Stay in root to show all folders
              selectedFolderInTab = null;
              newFolderName = '';
              showCreateFolderModal = false;
              showActionMessage_('Folder created and saved successfully.');
            } catch (err) {
              console.error('Create folder error:', err);
              showActionMessage_('Error creating folder: ' + (err?.message || 'Unknown error'), 'error');
            } finally {
              isCreatingFolder = false;
            }
          }} disabled={!newFolderName.trim() || isCreatingFolder}>
            {#if isCreatingFolder}
              <span class="spinning-icon" style="margin-right: 0.4rem; display: inline-flex;"><Loader2 size={16} /></span>
              <span>Creating...</span>
            {:else}
              <Folder size={18} />
              <span>Create Folder</span>
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Rename Folder Modal -->
  {#if showRenameFolderModal && folderToRename}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="modal-overlay" on:click={() => (showRenameFolderModal = false)}>
      <div class="modal" on:click={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>Rename Folder</h2>
          <button class="close-btn" on:click={() => (showRenameFolderModal = false)}>×</button>
        </div>

        <div class="modal-body">
          <div class="form-group">
            <label for="renameFolderInput">New Name</label>
            <input
              id="renameFolderInput"
              type="text"
              bind:value={renameFolderInputValue}
              on:keydown={(e) => {
                if (e.key === 'Enter') renameFolder();
              }}
            />
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" on:click={() => (showRenameFolderModal = false)}>Cancel</button>
          <button class="btn btn-primary" on:click={renameFolder} disabled={!renameFolderInputValue.trim()}>
            <span>Rename Folder</span>
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Delete Folder Confirmation Modal -->
  {#if showDeleteFolderConfirm && folderToDelete}
    {@const folderPath = typeof folderToDelete === 'string' ? folderToDelete : folderToDelete.path}
    {@const folderName = getFolderNameFromPath_(folderPath)}
    {@const folderDocumentCount = getFolderTreeDocumentCount_(folderPath)}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="modal-overlay" on:click={() => !isDeletingFolder && (showDeleteFolderConfirm = false)}>
      <div class="modal delete-modal" on:click={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <div class="delete-icon-container">
            <Trash2 size={24} />
          </div>
          <h2>Delete Folder</h2>
          <button class="close-btn" on:click={() => !isDeletingFolder && (showDeleteFolderConfirm = false)} disabled={isDeletingFolder}>×</button>
        </div>

        <div class="modal-body">
          <div class="confirmation-content">
            <p>Are you sure you want to delete <strong>"{folderName}"</strong>?</p>
            <p class="warning-text">
              This folder{folderDocumentCount > 0 ? ` and ${folderDocumentCount} document${folderDocumentCount !== 1 ? 's' : ''} inside it` : ''} will be permanently deleted.
              Move any documents you want to keep before continuing. This action cannot be undone.
            </p>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" on:click={() => !isDeletingFolder && (showDeleteFolderConfirm = false)} disabled={isDeletingFolder}>Cancel</button>
          <button class="btn btn-danger" on:click={() => deleteFolder(folderPath)} disabled={isDeletingFolder}>
            {#if isDeletingFolder}
              <span class="spinning-icon"><Loader2 size={16} /></span>
            {:else}
              <Trash2 size={16} />
            {/if}
            <span>{isDeletingFolder ? 'Deleting...' : 'Delete Folder'}</span>
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Delete Document Confirmation Modal -->
  {#if showDeleteConfirm && documentToDelete}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="modal-overlay" on:click={() => (showDeleteConfirm = false)}>
      <div class="modal delete-modal" on:click={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <div class="delete-icon-container">
            <Trash2 size={24} />
          </div>
          <h2>Delete Document</h2>
          <button class="close-btn" on:click={() => (showDeleteConfirm = false)}>×</button>
        </div>

        <div class="modal-body">
          <div class="confirmation-content">
            <p>Are you sure you want to delete <strong>"{documentToDelete.name}"</strong>?</p>
            <p class="warning-text">This document will be permanently deleted. This action cannot be undone.</p>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" on:click={() => (showDeleteConfirm = false)} disabled={isDeleting}>Cancel</button>
          <button class="btn btn-danger" on:click={() => deleteDocument(documentToDelete.id)} disabled={isDeleting}>
            {#if isDeleting}
              <span class="spinning-icon"><Loader2 size={16} /></span>
            {:else}
              <Trash2 size={16} />
            {/if}
            <span>{isDeleting ? 'Deleting...' : 'Delete Document'}</span>
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Delete Multiple Documents Confirmation Modal -->
  {#if showBulkDeleteConfirm && selectedDocuments.size > 0}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="modal-overlay" on:click={() => (showBulkDeleteConfirm = false)}>
      <div class="modal delete-modal" on:click={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <div class="delete-icon-container">
            <Trash2 size={24} />
          </div>
          <h2>Delete Documents</h2>
          <button class="close-btn" on:click={() => (showBulkDeleteConfirm = false)}>×</button>
        </div>

        <div class="modal-body">
          <div class="confirmation-content">
            <p>Are you sure you want to delete <strong>{selectedDocuments.size} document{selectedDocuments.size !== 1 ? 's' : ''}</strong>?</p>
            <p class="warning-text">This action cannot be undone. All selected documents will be permanently removed.</p>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" on:click={() => (showBulkDeleteConfirm = false)} disabled={isDeleteBulkProcessing}>Cancel</button>
          <button class="btn btn-danger" on:click={confirmBulkDelete} disabled={isDeleteBulkProcessing}>
            {#if isDeleteBulkProcessing}
              <span class="spinning-icon"><Loader2 size={16} /></span>
            {:else}
              <Trash2 size={16} />
            {/if}
            <span>{isDeleteBulkProcessing ? `Deleting (${[...selectedDocuments].length})...` : `Delete ${selectedDocuments.size} Document${selectedDocuments.size !== 1 ? 's' : ''}`}</span>
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Move Multiple Documents Modal -->
  {#if showBulkMoveModal && selectedDocuments.size > 0}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="modal-overlay" on:click={closeBulkMoveModal}>
      <div class="modal delete-modal" on:click={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <div class="delete-icon-container">
            <FolderOpen size={24} />
          </div>
          <h2>Move Documents</h2>
          <button class="close-btn" on:click={closeBulkMoveModal}>×</button>
        </div>

        <div class="modal-body">
          <div class="confirmation-content">
            <p>Move <strong>{selectedDocuments.size} document{selectedDocuments.size !== 1 ? 's' : ''}</strong> to:</p>
            <div class="form-group">
              <div id="bulk-move-destination-label" class="form-label">Destination Folder</div>
              <div class="folder-picker-list" role="listbox" aria-labelledby="bulk-move-destination-label">
                <button
                  type="button"
                  class="folder-picker-option"
                  class:active={bulkMoveTargetFolder === '/'}
                  on:click={() => (bulkMoveTargetFolder = '/')}
                  disabled={isBulkMoveProcessing}
                >
                  None
                </button>
                {#each normalizedFolders as folderPath (folderPath)}
                  <button
                    type="button"
                    class="folder-picker-option"
                    class:active={bulkMoveTargetFolder === folderPath}
                    on:click={() => (bulkMoveTargetFolder = folderPath)}
                    disabled={isBulkMoveProcessing}
                  >
                    {folderPath.substring(1)}
                  </button>
                {/each}
              </div>
            </div>
            <p class="warning-text">
              Choosing None will remove the selected documents from any folder and place them at the root level.
            </p>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" on:click={closeBulkMoveModal} disabled={isBulkMoveProcessing}>Cancel</button>
          <button class="btn btn-primary" on:click={confirmBulkMove} disabled={isBulkMoveProcessing}>
            {#if isBulkMoveProcessing}
              <span class="spinning-icon"><Loader2 size={16} /></span>
              <span>Moving...</span>
            {:else}
              <FolderOpen size={16} />
              <span>Move Documents</span>
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Delete Multiple Folders Confirmation Modal -->
  {#if showDeleteFoldersConfirm && selectedFolders.size > 0}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="modal-overlay" on:click={() => !isDeleteFoldersProcessing && (showDeleteFoldersConfirm = false)}>
      <div class="modal delete-modal" on:click={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <div class="delete-icon-container">
            <Trash2 size={24} />
          </div>
          <h2>Delete Folders</h2>
          <button class="close-btn" on:click={() => !isDeleteFoldersProcessing && (showDeleteFoldersConfirm = false)} disabled={isDeleteFoldersProcessing}>×</button>
        </div>

        <div class="modal-body">
          <div class="confirmation-content">
            <p>Are you sure you want to delete <strong>{selectedFolders.size} folder{selectedFolders.size !== 1 ? 's' : ''}</strong>?</p>
            <p class="warning-text">All documents in these folders will be permanently deleted. Move any documents you want to keep before continuing. This action cannot be undone.</p>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" on:click={() => !isDeleteFoldersProcessing && (showDeleteFoldersConfirm = false)} disabled={isDeleteFoldersProcessing}>Cancel</button>
          <button class="btn btn-danger" on:click={confirmBulkDeleteFolders} disabled={isDeleteFoldersProcessing}>
            {#if isDeleteFoldersProcessing}
              <span class="spinning-icon"><Loader2 size={16} /></span>
            {:else}
              <Trash2 size={16} />
            {/if}
            <span>{isDeleteFoldersProcessing ? `Deleting (${[...selectedFolders].length})...` : `Delete ${selectedFolders.size} Folder${selectedFolders.size !== 1 ? 's' : ''}`}</span>
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Share Modal -->
  {#if showShareModal && selectedDocForShare}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="modal-overlay" on:click={() => (showShareModal = false)}>
      <div class="modal" on:click={(e) => e.stopPropagation()}>
        <div class="modal-header share-modal-header">
          <div class="delete-icon-container">
            <Share2 size={24} />
          </div>
          <h2>Share "{selectedDocForShare.name}"</h2>
          <button class="close-btn" on:click={() => (showShareModal = false)}>×</button>
        </div>

        <div class="modal-body">
          <div class="share-form">
            <div class="form-group">
              <div id="share-visibility-label" class="form-label">Visibility</div>
              <div class="visibility-mode-grid" role="tablist" aria-labelledby="share-visibility-label">
                <button type="button" class="visibility-chip" class:active={shareVisibilityMode === 'private'} on:click={() => (shareVisibilityMode = 'private')}>Only me</button>
                <button type="button" class="visibility-chip" class:active={shareVisibilityMode === 'everyone'} on:click={() => (shareVisibilityMode = 'everyone')}>Everyone</button>
                <button type="button" class="visibility-chip" class:active={shareVisibilityMode === 'specific'} on:click={() => (shareVisibilityMode = 'specific')}>Specific people</button>
                <button type="button" class="visibility-chip" class:active={shareVisibilityMode === 'everyone_except'} on:click={() => (shareVisibilityMode = 'everyone_except')}>Everyone except...</button>
              </div>
            </div>

            {#if shareVisibilityMode === 'specific' || shareVisibilityMode === 'everyone_except'}
              <div class="form-group">
                <div id="share-candidates-label" class="form-label">{shareVisibilityMode === 'specific' ? 'Allowed people' : 'Excluded people'}</div>
                <div class="share-candidates-search">
                  <Search size={14} />
                  <input
                    type="text"
                    placeholder="Search people..."
                    bind:value={shareCandidateSearch}
                  />
                </div>
                {#if selectedSharePreview.length > 0}
                  <div class="selected-share-preview" aria-label="Selected people">
                    {#each selectedSharePreview as candidate (candidate.user_id)}
                      <span class="selected-share-pill">
                        {candidate.full_name}
                      </span>
                    {/each}
                  </div>
                {/if}
                <div class="share-candidates-list" role="group" aria-labelledby="share-candidates-label">
                  {#if filteredShareCandidates.length > 0}
                    {#each filteredShareCandidates as candidate (candidate.user_id)}
                      <label class="share-candidate-item">
                        <input
                          type="checkbox"
                          checked={selectedShareUserIds.has(candidate.user_id)}
                          on:change={() => toggleShareCandidate_(candidate.user_id)}
                        />
                        <span>{candidate.full_name} ({candidate.role})</span>
                      </label>
                    {/each}
                  {:else}
                    <div class="empty-shares">
                      <p>No users found in your group.</p>
                    </div>
                  {/if}
                </div>
              </div>
            {/if}

          </div>

          <!-- Current Shares -->
          {#if selectedDocForShare.sharedWith && selectedDocForShare.sharedWith.length > 0}
            <div class="shares-list">
              <h3>Currently Shared With</h3>
              {#each selectedDocForShare.sharedWith as share (share.email)}
                <div class="share-item">
                <div class="share-info">
                    <div class="share-email">{share.email}</div>
                    <div class="share-role">{share.role} â€¢ Shared {formatDate(share.sharedDate)}</div>
                  </div>
                  <button
                    class="remove-share-btn"
                    on:click={() => removeShare(selectedDocForShare.id, share.email)}
                    title="Remove access"
                  >
                    <X size={16} />
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" on:click={() => (showShareModal = false)}>Close</button>
            <button class="btn btn-primary" on:click={applyShareVisibility} disabled={isApplyingShareVisibility}>
            {#if isApplyingShareVisibility}
              <span class="spinning-icon" style="margin-right: 0.4rem; display: inline-flex;"><Loader2 size={16} /></span>
              <span>Applying...</span>
            {:else}
              <Check size={18} />
              <span>Apply</span>
            {/if}
            </button>
          </div>
      </div>
    </div>
  {/if}
</section>

<style>
  .page-shell {
    --doc-surface: #ffffff;
    --doc-surface-soft: #f4f8fc;
    --doc-border: #d8e2ef;
    --doc-text: #0f172a;
    --doc-muted: #5f7188;
    --doc-accent: #0f6cbd;
    --doc-accent-soft: #d8ebff;
    position: relative;
    border-radius: 1.25rem;
    padding: 0.35rem;
    isolation: isolate;
  }

  .page-shell::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -2;
    border-radius: 1.25rem;
    background: var(--color-app-bg);
  }

  .page-shell::after {
    display: none;
  }

  .documents-container {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 2rem;
  }

  .documents-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 2rem;
  }

  .action-message {
    display: flex;
    align-items: center;
    padding: 0.75rem 1rem;
    border-radius: 10px;
    border: 1px solid transparent;
    font-size: 0.9rem;
    font-weight: 600;
    line-height: 1.35;
  }

  .action-message-success {
    background: #dcfce7;
    color: #0f766e;
    border-color: #86efac;
  }

  .action-message-error {
    background: #fee2e2;
    color: #b91c1c;
    border-color: #fca5a5;
  }

  .page-title {
    margin: 0;
    font-size: 2rem;
    font-weight: 800;
    color: var(--doc-text);
  }

  .page-subtitle {
    margin: 0.5rem 0 0;
    color: var(--doc-muted);
    font-size: 0.95rem;
  }

  .header-actions {
    display: flex;
    gap: 1rem;
  }

  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.7rem 1.2rem;
    border-radius: 10px;
    border: none;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
    font-size: 0.95rem;
  }

  .btn-primary {
    background: linear-gradient(135deg, #0f6cbd 0%, #0ea5e9 100%);
    color: white;
  }

  .btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 15px rgba(15, 108, 189, 0.35);
  }

  .btn-secondary {
    background: #eef5fc;
    color: #11406d;
    border: 1px solid #d8e2ef;
  }

  .btn-secondary:hover {
    background: #e2edf9;
  }

  .btn-danger {
    background: #ef4444;
    color: white;
    border: none;
  }

  .btn-danger:hover {
    background: #dc2626;
    transform: translateY(-2px);
    box-shadow: 0 8px 15px rgba(239, 68, 68, 0.3);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .spinning-icon {
    animation: spin 1s linear infinite;
  }

  .modal-title-stack {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .modal-title-stack p {
    margin: 0;
    font-size: 0.82rem;
    line-height: 1.35;
    font-weight: 500;
    color: #8ea1bb;
  }

  .modal-upload .modal-header,
  .modal-folder-create .modal-header {
    align-items: flex-start;
  }

  :global(html:not(.dark)) .modal-title-stack p {
    color: #5f7188;
  }

  .folder-picker-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.55rem;
    margin-top: 0.45rem;
    max-height: 210px;
    overflow-y: auto;
    padding-right: 0.2rem;
  }

  .folder-picker-list::-webkit-scrollbar {
    width: 8px;
  }

  .folder-picker-list::-webkit-scrollbar-track {
    background: rgba(15, 23, 42, 0.35);
    border-radius: 999px;
  }

  .folder-picker-list::-webkit-scrollbar-thumb {
    background: rgba(96, 165, 250, 0.55);
    border-radius: 999px;
  }

  .folder-picker-option {
    height: 40px;
    border-radius: 8px;
    border: 1px solid rgba(96, 165, 250, 0.28);
    background: rgba(15, 23, 42, 0.42);
    color: #cfe0ff;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.18s ease;
  }

  .folder-picker-option:hover:not(:disabled) {
    border-color: rgba(96, 165, 250, 0.5);
    background: rgba(30, 64, 175, 0.22);
  }

  .folder-picker-option.active {
    border-color: rgba(59, 130, 246, 0.9);
    background: rgba(37, 99, 235, 0.32);
    color: #eff6ff;
  }

  :global(html:not(.dark)) .folder-picker-option {
    background: #f2f7ff;
    color: #1e293b;
    border-color: #bfd4f3;
  }

  :global(html:not(.dark)) .folder-picker-option.active {
    background: #dbeafe;
    border-color: #60a5fa;
    color: #1e3a8a;
  }

  @media (max-width: 640px) {
    .folder-picker-list {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .share-candidates-list {
    max-height: 7.1rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.55rem;
    border: 1px solid rgba(96, 165, 250, 0.25);
    border-radius: 8px;
    background: rgba(15, 23, 42, 0.3);
  }

  .selected-share-preview {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin: 0.2rem 0 0.35rem;
  }

  .selected-share-pill {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    padding: 0.28rem 0.6rem;
    border-radius: 999px;
    background: rgba(59, 130, 246, 0.16);
    border: 1px solid rgba(59, 130, 246, 0.35);
    color: #dbeafe;
    font-size: 0.72rem;
    font-weight: 700;
    line-height: 1.2;
  }

  .share-candidate-item {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    font-size: 0.9rem;
    color: #d6e2f6;
  }

  .share-modal-header {
    flex-direction: column;
    align-items: center;
    gap: 0.8rem;
    text-align: center;
    position: relative;
  }

  .share-modal-header h2 {
    max-width: 100%;
    line-height: 1.15;
    text-wrap: balance;
    word-break: break-word;
  }

  .share-modal-header .close-btn {
    position: absolute;
    top: 1rem;
    right: 1rem;
  }

  .share-candidates-search {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.4rem 0.65rem;
    margin: 0.55rem 0 0.35rem;
    border-radius: 8px;
    border: 1px solid rgba(96, 165, 250, 0.25);
    background: rgba(15, 23, 42, 0.32);
  }

  .share-candidates-search input {
    flex: 1;
    border: 0;
    outline: none;
    background: transparent;
    color: #e2e8f0;
    font-size: 0.85rem;
  }

  .share-candidates-search input::placeholder {
    color: #94a3b8;
  }

  .share-candidates-list::-webkit-scrollbar {
    width: 8px;
  }

  .share-candidates-list::-webkit-scrollbar-track {
    background: rgba(15, 23, 42, 0.35);
    border-radius: 999px;
  }

  .share-candidates-list::-webkit-scrollbar-thumb {
    background: rgba(96, 165, 250, 0.55);
    border-radius: 999px;
  }

  :global(html:not(.dark)) .share-modal-header .close-btn {
    top: 1rem;
    right: 1rem;
  }

  :global(html:not(.dark)) .share-candidates-search {
    background: #f2f7ff;
    border-color: #bfd4f3;
  }

  :global(html:not(.dark)) .share-candidates-search input {
    color: #0f172a;
  }

  :global(html:not(.dark)) .share-candidates-search input::placeholder {
    color: #64748b;
  }

  :global(html:not(.dark)) .share-candidate-item {
    color: #0f172a;
    background: #ffffff;
    border: 1px solid #d8e2ef;
    padding: 0.55rem 0.65rem;
    border-radius: 8px;
  }

  .visibility-mode-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
    margin-top: 0.35rem;
  }

  .visibility-chip {
    height: 38px;
    border-radius: 8px;
    border: 1px solid rgba(96, 165, 250, 0.3);
    background: rgba(15, 23, 42, 0.42);
    color: #cfe0ff;
    font-size: 0.86rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.18s ease;
  }

  .visibility-chip:hover {
    border-color: rgba(96, 165, 250, 0.58);
    background: rgba(30, 64, 175, 0.2);
  }

  .visibility-chip.active {
    border-color: rgba(59, 130, 246, 0.9);
    background: rgba(37, 99, 235, 0.34);
    color: #eff6ff;
  }

  :global(html:not(.dark)) .visibility-chip {
    background: #f2f7ff;
    color: #1e293b;
    border-color: #bfd4f3;
  }

  :global(html:not(.dark)) .visibility-chip.active {
    background: #dbeafe;
    border-color: #60a5fa;
    color: #1e3a8a;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .spinning-icon {
    animation: spin 0.9s linear infinite;
  }

  .modal-title-stack {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .modal-title-stack p {
    margin: 0;
    font-size: 0.82rem;
    line-height: 1.35;
    font-weight: 500;
    color: #8ea1bb;
  }

  .modal-upload .modal-header,
  .modal-folder-create .modal-header {
    align-items: flex-start;
  }

  :global(html:not(.dark)) .modal-title-stack p {
    color: #5f7188;
  }
  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .search-filter-container {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.5rem;
    background: var(--doc-surface);
    border-radius: 12px;
    border: 1px solid var(--doc-border);
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: #eef5fc;
    border: 1px solid var(--doc-border);
    border-radius: 10px;
    color: var(--doc-muted);
  }

  .category-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .category-tab {
    padding: 0.5rem 1rem;
    background: #eef5fc;
    border: 1px solid var(--doc-border);
    border-radius: 20px;
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 500;
    color: #4f657f;
    transition: all 0.2s ease;
  }

  .category-tab:hover {
    border-color: #0f6cbd;
    color: #0f6cbd;
    background: #e0efff;
  }

  .category-tab.active {
    background: linear-gradient(135deg, #0f6cbd 0%, #0ea5e9 100%);
    color: white;
    border-color: transparent;
  }

  /* Folder Tabs in Upload Modal */
  .folder-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .folder-tab {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: #eef5fc;
    border: 1px solid var(--doc-border);
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 500;
    color: #4f657f;
    transition: all 0.2s ease;
  }

  .folder-tab:hover {
    border-color: #0f6cbd;
    color: #0f6cbd;
    background: #e0efff;
  }

  .folder-tab.active {
    background: linear-gradient(135deg, #0f6cbd 0%, #0ea5e9 100%);
    color: white;
    border-color: transparent;
  }

  /* Folder Grid Layout */
  .folder-search-wrapper {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0 0.75rem;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    margin-bottom: 1rem;
    height: 2.5rem;
  }

  .search-icon {
    color: #9ca3af;
    flex-shrink: 0;
  }

  .folder-search-input {
    flex: 1;
    border: none;
    background: transparent;
    outline: none;
    font-size: 0.9rem;
    color: var(--doc-text);
    padding: 0;
    height: 100%;
  }

  .folder-search-input::placeholder {
    color: var(--doc-muted);
  }

  .folder-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.8rem;
    margin-bottom: 0.5rem;
  }

  .folder-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    padding: 1.2rem 1rem;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 500;
    color: #cbd5e1;
    transition: all 0.2s ease;
    text-align: center;
  }

  .folder-card:hover {
    border-color: rgba(96, 165, 250, 0.6);
    color: #e2e8f0;
    background: rgba(59, 130, 246, 0.1);
  }

  .folder-card.active {
    background: rgba(59, 130, 246, 0.2);
    color: white;
    border-color: rgba(96, 165, 250, 0.9);
    box-shadow: none;
  }

  .folder-card .folder-name {
    word-break: break-word;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .no-folders-message {
    text-align: center;
    padding: 1.5rem 1rem;
    color: #9ca3af;
    font-size: 0.9rem;
  }

  .selected-folder-text {
    margin-top: 0.5rem;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--doc-muted);
  }

  /* Table Styles */
  .documents-table-container {
    background: var(--doc-surface);
    border-radius: 12px;
    border: 1px solid var(--doc-border);
    overflow: visible;
  }

  .table-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem;
    border-bottom: 1px solid var(--doc-border);
  }

  .doc-count {
    color: var(--doc-muted);
    font-size: 0.9rem;
  }

  .table-wrapper {
    overflow-x: auto;
    overflow-y: visible;
  }

  .documents-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.95rem;
  }

  .documents-table thead {
    background: #f3f8ff;
    border-bottom: 2px solid var(--doc-border);
  }

  .documents-table thead th {
    padding: 1rem;
    text-align: left;
    font-weight: 600;
    color: #1f3857;
    text-transform: uppercase;
    font-size: 0.85rem;
    letter-spacing: 0.5px;
  }
  .documents-table tbody tr {
    border-bottom: 1px solid #edf3fb;
    transition: background 0.2s ease;
    cursor: pointer;
  }

  .documents-table tbody tr:hover {
    background: #f3f8ff;
  }

  .documents-table td {
    padding: 1rem;
    color: var(--doc-text);
    vertical-align: middle;
  }

  .table-row {
    height: 60px;
  }

  .col-name {
    font-weight: 500;
    max-width: 250px;
  }

  .file-info {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .file-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    background: linear-gradient(135deg, #0f6cbd 0%, #0ea5e9 100%);
    border-radius: 8px;
    color: white;
    flex-shrink: 0;
  }

  .file-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
  }

  .col-type {
    width: 100px;
  }

  .type-badge {
    display: inline-block;
    padding: 0.35rem 0.65rem;
    background: #dcfce7;
    color: #0f766e;
    border-radius: 6px;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .col-category {
    width: 120px;
  }

  .category-badge {
    display: inline-block;
    padding: 0.35rem 0.65rem;
    background: #dbeafe;
    color: #1d4ed8;
    border-radius: 6px;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .col-size {
    width: 100px;
    color: var(--doc-muted);
    font-size: 0.9rem;
  }

  .col-date {
    width: 130px;
    white-space: nowrap;
    color: var(--doc-muted);
    font-size: 0.9rem;
  }

  .col-status {
    width: 140px;
  }

  .status-badge {
    display: inline-block;
    padding: 0.35rem 0.65rem;
    border-radius: 6px;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .col-actions {
    width: 140px;
  }

  .action-buttons {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    background: #eef5fc;
    border: 1px solid var(--doc-border);
    border-radius: 8px;
    cursor: pointer;
    color: #0f6cbd;
    transition: all 0.2s ease;
  }

  .icon-btn:hover {
    background: #dbeafe;
    color: #0f3868;
    border-color: #93c5fd;
  }

  .icon-btn.share-btn {
    color: #0f6cbd;
  }

  .icon-btn.delete-btn {
    color: #ef4444;
  }

  .icon-btn.delete-btn:hover {
    background: #fee2e2;
    color: #991b1b;
    border-color: #ef4444;
  }

  /* Folder Navigation Styles */
  .folder-nav {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.5rem;
    background: var(--doc-surface);
    border: 1px solid var(--doc-border);
    border-radius: 12px;
  }

  .folders-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }

  .folder-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    background: #f8fbff;
    border: 1px solid var(--doc-border);
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: left;
  }

  .folder-item:hover {
    background: #f0f7ff;
    border-color: #bfd5ec;
  }

  .folder-item.active {
    background: linear-gradient(135deg, #0f6cbd 0%, #0ea5e9 100%);
    border-color: #0f6cbd;
    color: white;
  }

  .folder-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    background: rgba(15, 108, 189, 0.12);
    border-radius: 8px;
    color: #0f6cbd;
    flex-shrink: 0;
  }

  .folder-info {
    flex: 1;
  }

  .folder-name {
    font-weight: 600;
    color: var(--doc-text);
    margin: 0;
    font-size: 0.95rem;
  }

  .folder-count {
    font-size: 0.85rem;
    color: var(--doc-muted);
    margin: 0.25rem 0 0 0;
  }

  .folder-item-wrapper {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
  }

  .folder-actions {
    display: flex;
    gap: 0.4rem;
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  .folder-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: #eef5fc;
    border: 1px solid var(--doc-border);
    border-radius: 6px;
    cursor: pointer;
    font-size: 1rem;
    transition: all 0.2s ease;
    padding: 0;
    flex-shrink: 0;
  }

  .folder-action-btn:hover {
    background: #dbeafe;
    border-color: #93c5fd;
  }

  .folder-action-btn.rename-btn {
    color: #0f6cbd;
  }

  .folder-action-btn.rename-btn:hover {
    color: #0f3868;
    background: #dbeafe;
  }

  .folder-action-btn.delete-btn {
    color: #ef4444;
  }

  .folder-action-btn.delete-btn:hover {
    background: #fee2e2;
    color: #991b1b;
    border-color: #ef4444;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 3rem 2rem;
    text-align: center;
    color: var(--doc-muted);
  }

  .empty-state > :nth-child(1) {
    margin-bottom: 1rem;
    opacity: 0.5;
  }

  /* Share Functionality Styles */
  .share-link-box {
    display: flex;
    gap: 0.75rem;
    margin-top: 0.5rem;
  }

  .copy-btn {
    padding: 0.75rem 1rem;
    background: #eef5fc;
    border: 1px solid var(--doc-border);
    border-radius: 10px;
    cursor: pointer;
    color: #0f6cbd;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .copy-btn:hover {
    background: #dbeafe;
    color: #0f3868;
  }

  .share-form {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding: 1.5rem 0;
    border: 1px solid var(--doc-border);
    border-radius: 10px;
    padding: 1.5rem;
    margin-top: 1.5rem;
    background: #f3f8ff;
  }

  .share-form .form-group {
    margin-bottom: 0;
  }

  .shares-list {
    margin-top: 1.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--doc-border);
    max-height: 10rem;
    overflow-y: auto;
  }

  .modal-footer {
    justify-content: center;
    gap: 0.75rem;
  }

  .shares-list h3 {
    margin: 0 0 1rem 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--doc-text);
  }

  .share-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem;
    background: #f8fbff;
    border: 1px solid var(--doc-border);
    border-radius: 8px;
    margin-bottom: 0.75rem;
  }

  .share-info {
    flex: 1;
  }

  .share-email {
    font-weight: 500;
    color: var(--doc-text);
    font-size: 0.95rem;
  }

  .share-role {
    font-size: 0.85rem;
    color: var(--doc-muted);
    margin-top: 0.25rem;
  }

  .remove-share-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: #ef4444;
    padding: 0.5rem;
    transition: color 0.2s ease;
  }

  .remove-share-btn:hover {
    color: #991b1b;
  }

  .empty-shares {
    padding: 1.5rem;
    text-align: center;
    color: var(--doc-muted);
    font-size: 0.9rem;
    background: #f8fbff;
    border: 1px dashed #bfd5ec;
    border-radius: 8px;
  }

  /* Modal Styles */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(5, 10, 18, 0.72);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: #0f1c2f;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.48);
    max-width: 500px;
    width: 90%;
    max-height: 90vh;
    overflow-y: auto;
  }

  .modal-upload {
    max-width: 760px;
  }

  .modal-create-folder {
    max-width: 560px;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.1rem 1.4rem;
    border-bottom: 1px solid var(--doc-border);
  }

  .modal-header h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 700;
    color: #e2e8f0;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 1.8rem;
    cursor: pointer;
    color: #94a3b8;
    padding: 0;
    width: 2rem;
    height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-btn:hover {
    color: #e2e8f0;
  }

  .modal-body {
    padding: 1.2rem 1.4rem;
  }

  .upload-area {
    border: 1px dashed rgba(96, 165, 250, 0.6);
    border-radius: 8px;
    padding: 1.6rem 1.25rem;
    background: rgba(255, 255, 255, 0.02);
    text-align: center;
    transition: border-color 0.2s ease, background 0.2s ease;
  }

  .upload-area:hover {
    border-color: rgba(96, 165, 250, 0.9);
    background: rgba(59, 130, 246, 0.08);
  }

  .upload-label {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    cursor: pointer;
    color: #93c5fd;
  }

  .upload-label p {
    margin: 0;
    font-weight: 600;
    color: #e2e8f0;
  }

  .upload-label span {
    font-size: 0.9rem;
    color: #94a3b8;
  }

  .file-hint {
    font-size: 0.8rem;
    color: #7c8fa8;
    margin-top: 0.5rem !important;
  }

  .form-group {
    margin-bottom: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .form-group label {
    font-weight: 600;
    color: var(--doc-text);
    font-size: 0.95rem;
  }

  .form-group input {
    padding: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    font-size: 0.95rem;
    background: rgba(255, 255, 255, 0.04);
    color: #e2e8f0;
    outline: none;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }

  .form-group input:focus {
    border-color: #60a5fa;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
  }

  .preview-content {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
  }

  .preview-details--solo {
    width: 100%;
  }

  .preview-details {
    flex: 1;
  }

  .preview-section {
    margin-bottom: 0.75rem;
  }

  .preview-section label {
    display: block;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--doc-muted);
    margin-bottom: 0.2rem;
  }

  .preview-value {
    margin: 0;
    color: var(--doc-text);
    font-size: 0.92rem;
    font-weight: 500;
    line-height: 1.35;
  }

  .preview-category-select {
    width: 100%;
    padding: 0.5rem;
    border-radius: 8px;
    border: 1px solid var(--doc-border);
    background: #eef5fc;
    color: var(--doc-text);
  }

  .modal-footer {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
    padding: 1rem 1.4rem;
    border-top: 1px solid var(--doc-border);
  }

  .modal-footer-centered {
    justify-content: center !important;
    align-items: center;
  }

  .modal-footer-centered .btn {
    min-width: 7rem;
  }

  .confirmation-content {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .confirmation-content p {
    margin: 0;
    color: var(--doc-text);
    font-size: 0.95rem;
    line-height: 1.5;
  }

  .warning-text {
    color: #ef4444 !important;
    font-weight: 500;
  }

  :global(.dark) .page-shell {
    --doc-surface: #162338;
    --doc-surface-soft: #1b2a42;
    --doc-border: #2b3c57;
    --doc-text: #e5edf8;
    --doc-muted: #9ab0cb;
    --doc-accent: #5bb1ff;
    --doc-accent-soft: rgba(91, 177, 255, 0.18);
  }

  :global(.dark) .page-shell::before {
    background: var(--color-app-bg);
  }

  :global(.dark) .page-shell::after {
    display: none;
  }

  :global(.dark) .search-box,
  :global(.dark) .folder-tab,
  :global(.dark) .category-tab,
  :global(.dark) .icon-btn,
  :global(.dark) .folder-action-btn,
  :global(.dark) .copy-btn,
  :global(.dark) .form-group input,
  :global(.dark) .folder-search-input,
  :global(.dark) .folder-card {
    background: #1a2c45;
    border-color: #334b6b;
    color: #e2e8f0;
  }

  :global(.dark) .folder-search-wrapper {
    background: #0f1e30;
    border-color: #334b6b;
  }

  :global(.dark) .folder-card {
    background: #0f1e30;
    border-color: #334b6b;
    color: #b7c8dd;
  }

  :global(.dark) .folder-card:hover {
    border-color: rgba(96, 165, 250, 0.7);
    color: #e2e8f0;
    background: rgba(91, 177, 255, 0.1);
  }

  :global(.dark) .folder-card.active {
    background: rgba(59, 130, 246, 0.2);
    border-color: rgba(96, 165, 250, 0.9);
    box-shadow: none;
  }

  :global(.dark) .no-folders-message {
    color: #6b7280;
  }

  :global(.dark) .folder-filter-selector {
    background: rgba(15, 23, 42, 0.8);
    border-bottom-color: rgba(71, 85, 105, 0.4);
  }

  :global(.dark) .folder-selector-btn {
    border-color: rgba(71, 85, 105, 0.5);
    color: #94a3b8;
  }

  :global(.dark) .folder-selector-btn:hover {
    border-color: rgba(59, 130, 246, 0.6);
    background: rgba(59, 130, 246, 0.15);
    color: #cbd5e1;
  }

  :global(.dark) .folder-selector-btn.active {
    border-color: #3b82f6;
    background: rgba(59, 130, 246, 0.25);
    color: #60a5fa;
  }

  :global(.dark) .form-group input:focus {
    border-color: #7cc3ff;
    box-shadow: 0 0 0 3px rgba(91, 177, 255, 0.24);
  }

  :global(.dark) .preview-section label {
    color: #b7c8dd;
  }

  :global(.dark) .preview-value {
    color: #e8f1ff;
  }

  :global(.dark) .preview-category-select {
    background: #1a2c45;
    border-color: #334b6b;
    color: #e8f1ff;
  }

  :global(.dark) .btn-primary {
    background: linear-gradient(90deg, #0f6cbd, #0ea5e9);
    box-shadow: 0 14px 28px -16px rgba(15, 108, 189, 0.9);
  }

  :global(.dark) .btn-secondary {
    background: #2a3f5d;
    border-color: #426389;
    color: #cfe6ff;
  }

  :global(.dark) .btn-secondary:hover,
  :global(.dark) .icon-btn:hover,
  :global(.dark) .folder-action-btn:hover,
  :global(.dark) .copy-btn:hover {
    background: #365276;
    border-color: #5a83b0;
    color: #e0f2fe;
  }

  :global(.dark) .folder-item,
  :global(.dark) .share-item,
  :global(.dark) .empty-shares,
  :global(.dark) .share-form,
  :global(.dark) .documents-table thead,
  :global(.dark) .modal {
    background: linear-gradient(150deg, rgba(22, 35, 56, 0.96), rgba(19, 30, 49, 0.98));
    border-color: #2b3c57;
  }

  :global(.dark) .documents-table tbody tr {
    border-bottom-color: #2b3c57;
  }

  :global(.dark) .documents-table tbody tr:hover {
    background: rgba(43, 60, 87, 0.45);
  }

  :global(.dark) .folders-table thead {
    background: rgba(43, 60, 87, 0.4);
  }

  :global(.dark) .folders-table tbody tr {
    border-bottom-color: #2b3c57;
  }

  :global(.dark) .folders-table tbody tr:hover {
    background: rgba(43, 60, 87, 0.45);
  }

  :global(.dark) .folder-table-wrapper {
    background: rgba(43, 60, 87, 0.2);
    border-color: #2b3c57;
  }

  :global(.dark) .folder-item:hover {
    background: rgba(43, 60, 87, 0.45);
    border-color: #426389;
  }

  :global(.dark) .folder-icon {
    background: rgba(91, 177, 255, 0.18);
    color: #93c5fd;
    border: 1px solid rgba(125, 211, 252, 0.38);
  }

  :global(.dark) .type-badge {
    background: rgba(16, 185, 129, 0.2);
    color: #86efac;
    border: 1px solid rgba(16, 185, 129, 0.45);
  }

  :global(.dark) .upload-area {
    border-color: #426389;
    background: rgba(15, 23, 42, 0.35);
  }

  :global(.dark) .upload-area:hover {
    border-color: #7cc3ff;
    background: rgba(91, 177, 255, 0.12);
  }

  :global(.dark) .action-message-success {
    background: rgba(16, 185, 129, 0.2);
    color: #86efac;
    border-color: rgba(16, 185, 129, 0.45);
  }

  :global(.dark) .action-message-error {
    background: rgba(239, 68, 68, 0.2);
    color: #fca5a5;
    border-color: rgba(239, 68, 68, 0.45);
  }

  @media (max-width: 768px) {
    .documents-container {
      padding: 1rem;
    }

    .documents-header {
      flex-direction: column;
    }

    .header-actions {
      width: 100%;
      flex-direction: column;
    }

    .modal {
      width: 95%;
    }
  }

  /* Exact enterprise layout overrides */
  .page-shell {
    background: var(--color-app-bg);
    min-height: 100%;
    color: var(--color-text);
    border: 0;
    border-radius: 0;
    padding: 0;
  }

  .page-shell::before,
  .page-shell::after,
  :global(.dark) .page-shell::before,
  :global(.dark) .page-shell::after {
    display: none;
  }

  .topbar {
    display: none;
  }

  .page-title-group {
    min-width: 0;
  }

  .page-title {
    font-size: 22px;
    font-weight: 600;
    color: #f1f5f9;
    letter-spacing: -0.3px;
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
  }

  .page-title :global(svg) {
    color: #60a5fa;
  }

  .uploader-name {
    font-size: 12px;
    color: #94a3b8;
    background: rgba(255, 255, 255, 0.05);
    padding: 3px 8px;
    border-radius: 4px;
    white-space: nowrap;
  }

  .action-bar {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }

  .documents-container {
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 12px 0;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: all 0.2s ease;
    white-space: nowrap;
    line-height: 1;
  }

  .btn :global(svg) {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }

  .btn-ghost,
  .btn-secondary {
    background: rgba(255, 255, 255, 0.05);
    color: #94a3b8;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .btn-ghost:hover,
  .btn-secondary:hover {
    background: rgba(255, 255, 255, 0.09);
    color: #e2e8f0;
    border-color: rgba(255, 255, 255, 0.18);
    transform: translateY(0);
    box-shadow: none;
  }

  /* Skeleton Shimmer */
  .skeleton {
    position: relative;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 4px;
  }

  .skeleton::after {
    content: "";
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    transform: translateX(-100%);
    background-image: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0) 0,
      rgba(255, 255, 255, 0.03) 20%,
      rgba(255, 255, 255, 0.06) 60%,
      rgba(255, 255, 255, 0)
    );
    animation: shimmer 2s infinite;
  }

  @keyframes shimmer {
    100% {
      transform: translateX(100%);
    }
  }

  /* Light mode skeleton overrides */
  :global(html:not(.dark)) .skeleton {
    background: rgba(15, 23, 42, 0.05); /* Slight dark on light */
  }

  :global(html:not(.dark)) .skeleton::after {
    background-image: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0) 0,
      rgba(255, 255, 255, 0.4) 20%,
      rgba(255, 255, 255, 0.7) 60%,
      rgba(255, 255, 255, 0)
    );
  }

  .skeleton-stats {
    display: flex;
    gap: 20px;
  }

  .skeleton-stat-card {
    flex: 1;
    height: 100px;
    border-radius: 12px;
  }

  .skeleton-folders {
    display: flex;
    gap: 16px;
    margin-top: 15px;
  }

  .skeleton-folder-card {
    width: 260px;
    height: 70px;
    border-radius: 12px;
  }

  .skeleton-table-panel {
    border-radius: 12px;
    height: 400px;
    margin-top: 24px;
  }

  .docs-skeleton-stat-card {
    min-height: 112px;
  }

  .docs-skeleton-label {
    width: 118px;
    height: 12px;
    border-radius: 999px;
  }

  .docs-skeleton-icon {
    width: 28px;
    height: 28px;
    border-radius: 8px;
  }

  .docs-skeleton-value {
    width: 34px;
    height: 26px;
    border-radius: 6px;
    margin-top: 16px;
  }

  .docs-skeleton-sub {
    width: 138px;
    max-width: 70%;
    height: 12px;
    border-radius: 999px;
    margin-top: 8px;
  }

  .docs-skeleton-search {
    width: 100%;
    height: 39px;
    border-radius: 8px;
  }

  .docs-skeleton-panel {
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    overflow: hidden;
  }

  .docs-skeleton-tabs,
  .docs-skeleton-controls {
    pointer-events: none;
  }

  .docs-skeleton-tab {
    width: 118px;
    height: 30px;
    border-radius: 6px;
  }

  .docs-skeleton-count {
    width: 58px;
    height: 26px;
    border-radius: 6px;
  }

  .docs-skeleton-button {
    width: 124px;
    height: 32px;
    border-radius: 8px;
  }

  .docs-skeleton-button-primary {
    width: 160px;
  }

  .docs-skeleton-select {
    width: 60px;
    height: 32px;
    border-radius: 8px;
  }

  .docs-skeleton-sort {
    justify-content: flex-start;
    gap: 8px;
  }

  .docs-skeleton-sort-label {
    width: 48px;
    height: 14px;
    border-radius: 999px;
  }

  .docs-skeleton-sort-btn {
    width: 56px;
    height: 34px;
    border-radius: 6px;
  }

  .docs-skeleton-list {
    display: flex;
    flex-direction: column;
  }

  .docs-skeleton-row {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) 90px 90px 120px 104px;
    align-items: center;
    gap: 18px;
    min-height: 60px;
    padding: 12px 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .docs-skeleton-row-main {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .docs-skeleton-file-icon,
  .docs-skeleton-action {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    flex-shrink: 0;
  }

  .docs-skeleton-file-text {
    display: flex;
    flex-direction: column;
    gap: 7px;
    min-width: 0;
    flex: 1;
  }

  .docs-skeleton-file-name {
    width: min(280px, 78%);
    height: 14px;
    border-radius: 999px;
  }

  .docs-skeleton-uploader {
    width: 110px;
    height: 12px;
    border-radius: 999px;
  }

  .docs-skeleton-badge {
    width: 42px;
    height: 24px;
    border-radius: 999px;
  }

  .docs-skeleton-size {
    width: 54px;
    height: 14px;
    border-radius: 999px;
  }

  .docs-skeleton-date {
    width: 86px;
    height: 14px;
    border-radius: 999px;
  }

  .docs-skeleton-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }

  .btn-primary {
    background: #2563eb;
    color: #fff;
    border: 1px solid #3b82f6;
  }

  .btn-primary:hover {
    background: #1d4ed8;
    transform: translateY(-1px);
    box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35);
  }

  .btn-primary:active {
    transform: translateY(0);
  }

  .action-message {
    margin-bottom: 16px;
    border-radius: 8px;
    font-size: 12px;
  }

  .action-message-success {
    background: rgba(22, 163, 74, 0.16);
    border-color: rgba(34, 197, 94, 0.35);
    color: #86efac;
  }

  .action-message-error {
    background: rgba(220, 38, 38, 0.16);
    border-color: rgba(248, 113, 113, 0.35);
    color: #fca5a5;
  }

  .stats-row {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 12px;
  }

  .stat-card {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    padding: 16px 20px;
    transition: background 0.2s ease;
  }

  .stat-card:hover {
    background: rgba(255, 255, 255, 0.07);
  }

  .stat-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  }

  .stat-icon {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    background: rgba(255, 255, 255, 0.08);
    color: #ffffff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .stat-card--folders .stat-icon {
    color: #60a5fa;
    border-color: rgba(96, 165, 250, 0.46);
    background: rgba(59, 130, 246, 0.18);
  }

  .stat-card--documents .stat-icon {
    color: #34d399;
    border-color: rgba(52, 211, 153, 0.46);
    background: rgba(16, 185, 129, 0.18);
  }

  .stat-card--links .stat-icon {
    color: #a78bfa;
    border-color: rgba(167, 139, 250, 0.46);
    background: rgba(139, 92, 246, 0.18);
  }

  .stat-card--total .stat-icon {
    color: #f59e0b;
    border-color: rgba(245, 158, 11, 0.46);
    background: rgba(245, 158, 11, 0.18);
  }

  .stat-label {
    font-size: 11px;
    font-weight: 500;
    color: #ffffff;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .stat-value {
    font-size: 22px;
    font-weight: 600;
    color: #ffffff;
    line-height: 1.1;
  }

  .stat-sub {
    font-size: 12px;
    color: #e2e8f0;
    margin-top: 3px;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }

  .section-title {
    font-size: 13px;
    font-weight: 600;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.07em;
  }

  .section-link {
    font-size: 12px;
    color: #3b82f6;
    cursor: pointer;
    text-decoration: none;
  }

  .section-link:hover {
    color: #60a5fa;
  }

  .folders-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 32px;
  }

  .folder-breadcrumb {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.75rem 1rem;
    background: rgba(59, 130, 246, 0.08);
    border: 1px solid rgba(59, 130, 246, 0.2);
    border-radius: 10px;
    margin-bottom: 1.5rem;
    font-size: 0.9rem;
  }

  .breadcrumb-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: transparent;
    border: none;
    color: #3b82f6;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.2s ease;
  }

  .folder-card-wrap {
    position: relative;
  }

  .folder-card {
    width: 100%;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    padding: 18px 20px;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    gap: 14px;
    position: relative;
    overflow: hidden;
    text-align: left;
  }

  .folder-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: linear-gradient(90deg, #3b82f6, #8b5cf6);
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  .folder-card:hover,
  .folder-card.active {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.15);
    transform: translateY(-2px);
  }

  .folder-card.active::before {
    opacity: 1;
  }

  .folder-icon-wrap {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: rgba(59, 130, 246, 0.15);
    border: 1px solid rgba(59, 130, 246, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: #60a5fa;
  }

  .folder-name {
    font-size: 14px;
    font-weight: 500;
    color: #e2e8f0;
  }

  .folder-count {
    font-size: 12px;
    color: #475569;
    margin-top: 2px;
  }

  .folder-actions {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    gap: 6px;
    opacity: 1;
    transition: opacity 0.2s ease;
  }

  .folder-action-btn {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    background: rgba(15, 23, 42, 0.35);
    border: 1px solid rgba(148, 163, 184, 0.28);
    color: #94a3b8;
    font-size: 12px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: pointer;
  }

  .folder-action-btn.delete-btn {
    color: #fda4af;
  }

  .bottom-area {
    display: grid;
    grid-template-columns: 1fr;
    gap: 24px;
  }

  .search-filter-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }

  .search-wrap {
    flex: 1;
    min-width: 220px;
    position: relative;
  }

  .search-wrap :global(svg) {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    width: 15px;
    height: 15px;
    color: #475569;
  }

  .search-input {
    width: 100%;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 9px 14px 9px 36px;
    font-size: 13px;
    color: #e2e8f0;
    outline: none;
    transition: all 0.2s ease;
    font-family: inherit;
  }

  .search-input::placeholder {
    color: #475569;
  }

  .search-input:focus {
    border-color: rgba(59, 130, 246, 0.5);
    background: rgba(255, 255, 255, 0.07);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
  }

  .docs-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    gap: 16px;
    flex-wrap: wrap;
  }

  .folder-nav-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 22px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    width: 100%;
    flex-wrap: wrap;
  }

  .btn-back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 1px solid rgba(148, 163, 184, 0.3);
    background: rgba(59, 130, 246, 0.1);
    color: #3b82f6;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    font-family: inherit;
  }

  .btn-back:hover {
    background: rgba(59, 130, 246, 0.2);
    border-color: rgba(59, 130, 246, 0.5);
    color: #60a5fa;
  }

  .folder-breadcrumb {
    color: #e2e8f0;
    font-size: 13px;
    font-weight: 600;
  }

  .filter-tabs {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    padding: 12px 22px;
    flex: 1;
    border-bottom: none;
    margin-bottom: 0;
    align-items: center;
    border-right: 1px solid rgba(255, 255, 255, 0.07);
  }

  .filter-tab {
    padding: 8px 16px;
    border: none;
    background: transparent;
    color: #94a3b8;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    border-bottom: 2px solid transparent;
    white-space: nowrap;
    font-family: inherit;
  }

  .filter-tab:hover {
    color: #cbd5e1;
  }

  .filter-tab.active {
    color: #3b82f6;
    border-bottom-color: #3b82f6;
  }

  .folder-filter-selector {
    padding: 12px 22px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(15, 23, 42, 0.5);
  }

  .folder-open-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 22px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    color: #94a3b8;
    font-size: 13px;
  }

  .folder-back-btn,
  .folder-open-title {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }

  .folder-back-btn {
    border: 0;
    background: transparent;
    color: #60a5fa;
    cursor: pointer;
    font: inherit;
    padding: 0;
  }

  .folder-back-btn:hover {
    color: #93c5fd;
  }

  .folder-open-title {
    color: #e2e8f0;
    font-weight: 600;
  }

  .folder-selector-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 8px;
    margin-bottom: 8px;
  }

  .folder-selector-btn {
    padding: 8px 12px;
    border: 1px solid rgba(148, 163, 184, 0.3);
    background: transparent;
    color: #94a3b8;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s ease;
    font-family: inherit;
    text-align: center;
  }

  .folder-selector-btn:hover {
    border-color: rgba(59, 130, 246, 0.5);
    color: #cbd5e1;
    background: rgba(59, 130, 246, 0.1);
  }

  .folder-selector-btn.active {
    border-color: #3b82f6;
    background: rgba(59, 130, 246, 0.2);
    color: #3b82f6;
  }

  .folder-selector-name {
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header-controls {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 22px;
    flex-shrink: 0;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .docs-count {
    font-size: 12px;
    color: #475569;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 6px;
    padding: 4px 10px;
    white-space: nowrap;
    font-weight: 500;
  }

  .select-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    background: linear-gradient(135deg, #3b82f6, #2563eb);
    color: white;
    border: none;
    border-radius: 6px;
    padding: 8px 14px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
  }

  .select-btn:hover {
    opacity: 0.9;
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
  }

  .select-btn.cancel-btn {
    background: linear-gradient(135deg, #ef4444, #dc2626);
  }

  .select-btn.cancel-btn:hover {
    opacity: 0.9;
    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
  }

  .selection-info {
    font-size: 13px;
    color: #475569;
    font-weight: 600;
    padding: 0 8px;
    white-space: nowrap;
  }

  .delete-bulk-btn {
    background: #fecaca !important;
    color: #991b1b !important;
    border: 1px solid #fca5a5 !important;
  }

  .delete-bulk-btn:hover {
    background: #fca5a5 !important;
    color: #7f1d1d !important;
  }

  /* Select All Row */
  .select-all-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.05);
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    font-size: 12px;
    font-weight: 600;
    color: #cbd5e1;
    cursor: pointer;
    transition: all 0.2s;
    user-select: none;
  }

  .select-all-row:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #e2e8f0;
  }

  .select-all-checkbox {
    width: 16px;
    height: 16px;
    cursor: pointer;
  }

  .col-checkbox {
    width: 40px;
    padding: 12px 8px;
    text-align: center;
  }

  .table-checkbox {
    width: 16px;
    height: 16px;
    cursor: pointer;
  }

  .table-row.row-selected {
    background: rgba(59, 130, 246, 0.1);
  }

  .table-wrapper {
    overflow-x: auto;
  }

  .sort-bar {
    padding: 0.625rem 1.5rem;
    background: rgba(255, 255, 255, 0.02);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    justify-content: flex-end;
  }

  .sort-controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .sort-label {
    font-size: 0.8rem;
    color: #94a3b8;
    font-weight: 500;
  }

  .sort-btn {
    padding: 0.375rem 0.75rem;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 5px;
    color: #cbd5e1;
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .sort-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .sort-btn.active {
    background: rgba(15, 108, 189, 0.25);
    border-color: rgba(15, 108, 189, 0.5);
    color: #0ea5e9;
  }

  .documents-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .documents-table thead {
    background: rgba(255, 255, 255, 0.03);
  }

  .documents-table thead th {
    padding: 12px 14px;
    text-align: left;
    font-size: 11px;
    text-transform: uppercase;
    color: #64748b;
    letter-spacing: 0.04em;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .documents-table tbody tr {
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    transition: background 0.2s ease;
    cursor: pointer;
  }

  .documents-table tbody tr:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .documents-table td {
    padding: 12px 14px;
    color: #cbd5e1;
    vertical-align: middle;
  }

  .file-info {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .file-icon {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: rgba(59, 130, 246, 0.15);
    color: #60a5fa;
  }

  .file-name {
    color: #e2e8f0;
    font-size: 13px;
    font-weight: 500;
  }

  .file-name-btn {
    border: 0;
    background: transparent;
    padding: 0;
    margin: 0;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }

  .file-name-btn:hover .file-name {
    color: #93c5fd;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .type-badge,
  .status-badge {
    display: inline-flex;
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 500;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(255, 255, 255, 0.06);
    color: #94a3b8;
  }

  .folder-table-wrapper {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    overflow: visible;
  }

  .folders-table tbody tr.active {
    background: rgba(15, 108, 189, 0.15);
  }

  .folder-details-row {
    background: rgba(15, 108, 189, 0.08) !important;
    border-top: 2px solid rgba(15, 108, 189, 0.3) !important;
    border-bottom: 2px solid rgba(15, 108, 189, 0.3) !important;
  }

  .folder-documents-container {
    padding: 1.5rem;
  }

  .folder-docs-title {
    margin: 0 0 1rem 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: #0ea5e9;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .folder-docs-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }


  .folder-empty-state {
    padding: 2rem 1.5rem;
    text-align: center;
    color: #64748b;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }


  .recent-files-section {
    padding: 1.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .recent-title,
  .folders-title {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 0 0 1rem 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: #e2e8f0;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .recent-files-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .recent-file-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    transition: all 0.2s ease;
    cursor: pointer;
  }

  .recent-file-item:hover {
    background: rgba(15, 108, 189, 0.1);
    border-color: rgba(15, 108, 189, 0.3);
  }

  .recent-file-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: rgba(15, 108, 189, 0.15);
    border-radius: 6px;
    color: #0f6cbd;
    flex-shrink: 0;
  }

  .recent-file-info {
    flex: 1;
    min-width: 0;
  }

  .recent-file-name {
    display: block;
    font-weight: 500;
    color: #e2e8f0;
    font-size: 0.9rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .recent-file-meta {
    display: flex;
    gap: 0.75rem;
    margin-top: 0.25rem;
    font-size: 0.8rem;
    color: #94a3b8;
  }

  .recent-file-folder {
    display: inline-block;
    padding: 0.2rem 0.5rem;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 4px;
  }

  .no-recent-message {
    margin: 0;
    padding: 1rem;
    text-align: center;
    color: #64748b;
    font-size: 0.9rem;
  }

  .folders-title {
    padding: 0 1.5rem;
    padding-top: 1.5rem;
    margin-bottom: 1rem;
  }

  .folders-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    padding: 0 1.5rem 1.5rem 1.5rem;
  }

  .folders-table thead {
    background: rgba(255, 255, 255, 0.03);
  }

  .folders-table thead th {
    padding: 12px 14px;
    text-align: left;
    font-size: 11px;
    text-transform: uppercase;
    color: #64748b;
    letter-spacing: 0.04em;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .folders-table tbody tr {
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    transition: background 0.2s ease;
  }

  .folders-table tbody tr:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .folders-table td {
    padding: 12px 14px;
    color: #cbd5e1;
    vertical-align: middle;
  }

  .col-creator,
  .col-files {
    text-align: left;
  }

  .col-checkbox {
    width: 40px;
    padding: 8px 12px;
  }

  .col-checkbox input[type="checkbox"] {
    width: 18px;
    height: 18px;
    cursor: pointer;
    accent-color: #3b82f6;
  }

  .col-checkbox input[type="checkbox"]:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .col-actions {
    width: 50px;
    text-align: center;
  }

  .folders-table .col-actions {
    width: 96px;
    min-width: 96px;
  }

  .folders-table td.col-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  .folders-table td.col-actions .icon-btn {
    flex: 0 0 28px;
  }

  .folder-actions-menu {
    position: relative;
    display: inline-flex;
    justify-content: flex-end;
  }

  .folder-menu-btn {
    color: #60a5fa;
  }

  .folder-actions-popover {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    min-width: 160px;
    padding: 6px;
    border-radius: 12px;
    background: #0f1c2f;
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.24);
    z-index: 25;
  }

  .folder-action-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: #dbeafe;
    font-size: 12px;
    text-align: left;
  }

  .folder-action-item:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .folder-action-item.danger {
    color: #fca5a5;
  }

  .folders-table .icon-btn.rename-btn {
    color: #60a5fa;
  }

  .folders-table .icon-btn.rename-btn:hover {
    background: rgba(59, 130, 246, 0.16);
    border-color: rgba(96, 165, 250, 0.38);
    color: #bfdbfe;
  }

  .permission-denied {
    display: inline-block;
    font-size: 16px;
    opacity: 0.5;
  }

  .folders-actions-bar {
    padding: 1rem 1.5rem 0.5rem 1.5rem;
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }

  .btn-danger {
    background: #ef4444;
    color: white;
    border: 1px solid #dc2626;
  }

  .btn-danger:hover:not(:disabled) {
    background: #dc2626;
    border-color: #b91c1c;
  }

  .btn-danger:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .creator-name,
  .files-count {
    font-size: 13px;
    color: #cbd5e1;
  }
  .action-buttons {
    display: flex;
    gap: 6px;
  }

  .icon-btn {
    width: 28px;
    height: 28px;
    padding: 0;
    border-radius: 7px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #94a3b8;
    transition: all 0.2s ease;
  }

  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.09);
    color: #e2e8f0;
    border-color: rgba(255, 255, 255, 0.18);
  }

  .icon-btn.delete-btn {
    color: #fda4af;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 56px 24px;
    gap: 12px;
  }

  .empty-icon-wrap {
    width: 64px;
    height: 64px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 4px;
    color: #334155;
  }

  .empty-title {
    font-size: 15px;
    font-weight: 500;
    color: #94a3b8;
  }

  .empty-sub {
    font-size: 13px;
    color: #475569;
    text-align: center;
    max-width: 280px;
  }

  .empty-actions {
    display: flex;
    gap: 10px;
    margin-top: 8px;
  }

  .empty-btn {
    font-size: 12px;
    padding: 7px 14px;
  }

  .modal {
    background: #0f1c2f;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #e2e8f0;
  }

  .modal-header,
  .modal-footer {
    border-color: rgba(255, 255, 255, 0.08);
  }

  .modal-header h2,
  .form-group label,
  .confirmation-content p,
  .share-email,
  .shares-list h3 {
    color: #e2e8f0;
  }

  .form-group input,
  .copy-btn,
  .folder-tab,
  .upload-area,
  .share-item,
  .share-form,
  .empty-shares {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.1);
    color: #cbd5e1;
  }

  .form-group input::placeholder {
    color: #64748b;
  }

  .selected-folder-text {
    color: #94a3b8;
  }

  .warning-text,
  .remove-share-btn,
  .folder-action-btn.delete-btn {
    color: #fda4af !important;
  }

  @media (max-width: 720px) {
    .topbar {
      display: none;
    }

    .documents-container {
      padding: 12px 0;
    }

    .stats-row {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .folders-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .search-filter-bar {
      margin-bottom: 12px;
    }

    .search-wrap {
      min-width: 0;
    }

    .bottom-area,
    .bottom-area > div,
    .docs-panel,
    .docs-panel-header {
      min-width: 0;
      max-width: 100%;
      width: 100%;
      box-sizing: border-box;
    }

    .docs-panel {
      overflow: hidden;
    }

    .docs-panel-header {
      flex-direction: column;
      align-items: stretch;
      gap: 0;
    }

    .filter-tabs {
      flex: none;
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
      width: 100%;
      padding: 10px 14px;
      border-right: 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      flex-wrap: nowrap;
      overflow-x: auto;
      overflow-y: hidden;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
    }

    .filter-tabs::-webkit-scrollbar {
      display: none;
    }

    .header-controls {
      width: 100%;
      padding: 10px 14px;
      justify-content: flex-start;
      gap: 8px;
      flex-wrap: wrap;
    }

    .header-controls .btn,
    .header-controls .select-btn {
      padding: 7px 12px;
      font-size: 12px;
      flex: 0 0 auto;
    }

    .docs-skeleton-tabs {
      flex-wrap: nowrap;
    }

    .docs-skeleton-controls {
      display: flex;
      width: 100%;
      flex-wrap: wrap;
    }

    .docs-skeleton-button {
      width: 118px;
    }

    .docs-skeleton-button-primary {
      width: 150px;
    }

    .sort-bar {
      padding: 10px 14px;
      justify-content: flex-start;
    }

    .folder-open-header {
      padding: 10px 14px;
      flex-wrap: wrap;
    }

    .sort-controls {
      flex-wrap: wrap;
      row-gap: 6px;
    }

    .table-wrapper {
      width: 100%;
      max-width: 100%;
      overflow: hidden;
    }

    .documents-table,
    .documents-table tbody,
    .documents-table tr,
    .documents-table td {
      display: block;
      width: 100%;
    }

    .documents-table {
      border-collapse: separate;
      border-spacing: 0;
    }

    .documents-table thead {
      display: none;
    }

    .documents-table tbody tr {
      display: flex;
      flex-direction: column;
      gap: 8px;
      height: auto;
      padding: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    .documents-table td {
      padding: 0;
      border: 0;
    }

    .col-uploader,
    .col-size,
    .col-date,
    .col-uploader-header,
    .col-size-header,
    .col-date-header {
      display: none;
    }

    .col-name {
      max-width: none;
      width: 100%;
    }

    .col-type {
      margin-top: 0;
      width: fit-content;
      display: inline-flex;
      vertical-align: middle;
    }

    .col-actions {
      display: flex;
      width: 100%;
      float: none;
      clear: both;
      margin-top: 2px;
      justify-content: flex-end;
    }

    .action-buttons {
      gap: 4px;
      justify-content: flex-end;
    }

    .icon-btn {
      width: 26px;
      height: 26px;
    }

    .folder-table-wrapper {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }

    .folders-table {
      width: 100%;
      min-width: 0;
      table-layout: fixed;
    }

    .folders-table thead th,
    .folders-table td {
      padding: 10px 8px;
    }

    .folders-table .col-checkbox {
      width: 34px;
      padding-left: 8px;
      padding-right: 4px;
    }

    .folders-table .col-creator,
    .folders-table .col-creator-header {
      display: none;
    }

    .folders-table .col-files,
    .folders-table .col-files-header {
      width: 56px;
      text-align: center;
      padding-right: 12px;
    }

    .folders-table .col-actions {
      width: 78px;
      text-align: right;
      padding-left: 8px;
      padding-right: 8px;
      border-left: 1px solid rgba(255, 255, 255, 0.08);
    }

    .folders-table .col-actions .icon-btn {
      width: 30px;
      height: 30px;
    }

    .folders-table th.col-actions {
      padding-left: 10px;
      border-left: 1px solid rgba(255, 255, 255, 0.08);
    }

    .folders-table .file-info {
      gap: 8px;
      min-width: 0;
    }

    .folders-table .file-name {
      max-width: 100%;
    }

    .file-name {
      max-width: calc(100vw - 140px);
      display: inline-block;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .docs-skeleton-row {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
      min-height: 0;
      padding: 12px;
    }

    .docs-skeleton-row-main {
      width: 100%;
    }

    .docs-skeleton-file-name {
      width: min(220px, 78%);
    }

    .docs-skeleton-badge {
      width: 38px;
      height: 24px;
    }

    .docs-skeleton-size,
    .docs-skeleton-date {
      width: 72px;
    }

    .docs-skeleton-actions {
      width: 100%;
      justify-content: flex-end;
      margin-top: 2px;
    }
  }

  @media (max-width: 420px) {
    .folders-grid {
      grid-template-columns: 1fr;
    }

    .stats-row {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .filter-tabs {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
      padding: 10px 10px;
      gap: 6px;
      overflow: visible;
    }

    .filter-tab {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 34px;
      width: 100%;
      padding: 7px 8px;
      font-size: 12px;
      text-align: center;
      white-space: nowrap;
      line-height: 1.2;
    }

    .header-controls {
      display: grid;
      grid-template-columns: 1fr;
      padding: 8px 10px;
      gap: 6px;
    }

    .docs-count {
      display: none;
    }

    .header-controls .btn,
    .header-controls .select-btn {
      width: 100%;
      padding: 6px 10px;
      font-size: 11.5px;
      flex: none;
      justify-content: center;
    }

    .docs-skeleton-tabs {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
      padding: 10px;
    }

    .docs-skeleton-tab {
      width: 100%;
      height: 34px;
    }

    .docs-skeleton-controls {
      display: grid;
      grid-template-columns: 1fr;
      gap: 6px;
      padding: 8px 10px;
    }

    .docs-skeleton-count {
      display: none;
    }

    .docs-skeleton-button,
    .docs-skeleton-button-primary,
    .docs-skeleton-select {
      width: 100%;
      height: 28px;
    }
  }

  /* Light mode guard overrides for enterprise layout */
  :global(html:not(.dark)) .page-shell {
    background: #f6f9fd;
    color: #0f172a;
  }

  :global(html:not(.dark)) .topbar {
    border-bottom-color: #dbe6f2;
  }

  :global(html:not(.dark)) .page-title {
    color: #0f172a;
  }

  :global(html:not(.dark)) .page-subtitle,
  :global(html:not(.dark)) .folder-count,
  :global(html:not(.dark)) .chip,
  :global(html:not(.dark)) .docs-count,
  :global(html:not(.dark)) .documents-table thead th {
    color: #5f7188;
  }

  :global(html:not(.dark)) .btn-ghost,
  :global(html:not(.dark)) .btn-secondary {
    background: #eef5fc;
    color: #11406d;
    border-color: #d8e2ef;
  }

  :global(html:not(.dark)) .btn-ghost:hover,
  :global(html:not(.dark)) .btn-secondary:hover {
    background: #e2edf9;
    color: #0f172a;
    border-color: #bfd5ec;
  }

  :global(html:not(.dark)) .stat-card,
  :global(html:not(.dark)) .folder-card,
  :global(html:not(.dark)) .docs-panel,
  :global(html:not(.dark)) .modal {
    background: #ffffff;
    border-color: #d8e2ef;
  }

  :global(html:not(.dark)) .documents-container .stat-card {
    background: #ffffff !important;
    border-color: #d8e2ef !important;
  }

  :global(body.dark) .stat-card,
  :global(body.dark) .folder-card,
  :global(body.dark) .docs-panel,
  :global(body.dark) .modal,
  :global(html.dark) .stat-card,
  :global(html.dark) .folder-card,
  :global(html.dark) .docs-panel,
  :global(html.dark) .modal {
    background: #161c27;
    border-color: #ffffff12;
  }

  :global(body.dark) .documents-container .stat-card,
  :global(html.dark) .documents-container .stat-card {
    background: #161c27 !important;
    border-color: #ffffff12 !important;
    box-shadow: 0 1px 3px #00000040 !important;
  }

  :global(body.dark) .stat-card:hover,
  :global(html.dark) .stat-card:hover {
    background: #1e2736;
  }

  :global(body.dark) .documents-container .stat-card:hover,
  :global(html.dark) .documents-container .stat-card:hover {
    background: #1e2736 !important;
  }

  /* Force the top Documents stat cards to use the exact same surface token as sidebar in both modes */
  .documents-container .stats-row .stat-card {
    background: var(--s) !important;
    border-color: color-mix(in srgb, var(--b) 85%, transparent) !important;
  }

  .documents-container .stats-row .stat-card:hover {
    background: var(--s) !important;
  }

  :global(html:not(.dark)) .stat-value,
  :global(html:not(.dark)) .stat-label,
  :global(html:not(.dark)) .stat-sub,
  :global(html:not(.dark)) .folder-name,
  :global(html:not(.dark)) .docs-panel-title,
  :global(html:not(.dark)) .file-name,
  :global(html:not(.dark)) .uploader-name,
  :global(html:not(.dark)) .folder-path-badge,
  :global(html:not(.dark)) .type-badge,
  :global(html:not(.dark)) .documents-table td,
  :global(html:not(.dark)) .modal-header h2,
  :global(html:not(.dark)) .form-group label,
  :global(html:not(.dark)) .confirmation-content p,
  :global(html:not(.dark)) .share-email,
  :global(html:not(.dark)) .shares-list h3 {
    color: #0f172a;
  }

  :global(html:not(.dark)) .stat-icon {
    color: #0f172a;
    border-color: #d8e2ef;
    background: #eef5fc;
  }

  :global(html:not(.dark)) .stat-card--folders .stat-icon {
    color: #1d4ed8;
    border-color: #bfdbfe;
    background: #dbeafe;
  }

  :global(html:not(.dark)) .stat-card--documents .stat-icon {
    color: #047857;
    border-color: #a7f3d0;
    background: #d1fae5;
  }

  :global(html:not(.dark)) .stat-card--links .stat-icon {
    color: #6d28d9;
    border-color: #ddd6fe;
    background: #ede9fe;
  }

  :global(html:not(.dark)) .stat-card--total .stat-icon {
    color: #b45309;
    border-color: #fde68a;
    background: #fef3c7;
  }

  :global(html:not(.dark)) .search-input,
  :global(html:not(.dark)) .icon-btn,
  :global(html:not(.dark)) .folder-action-btn,
  :global(html:not(.dark)) .form-group input,
  :global(html:not(.dark)) .copy-btn,
  :global(html:not(.dark)) .folder-tab,
  :global(html:not(.dark)) .upload-area,
  :global(html:not(.dark)) .share-item,
  :global(html:not(.dark)) .share-form,
  :global(html:not(.dark)) .empty-shares,
  :global(html:not(.dark)) .chip {
    background: #eef5fc;
    border-color: #d8e2ef;
    color: #0f172a;
  }

  :global(html:not(.dark)) .documents-table thead {
    background: #f3f8ff;
  }

  :global(html:not(.dark)) .documents-table tbody tr,
  :global(html:not(.dark)) .docs-panel-header,
  :global(html:not(.dark)) .modal-header,
  :global(html:not(.dark)) .modal-footer {
    border-color: #d8e2ef;
  }

  :global(html:not(.dark)) .documents-table tbody tr:hover {
    background: #f3f8ff;
  }

  :global(html:not(.dark)) .selected-folder-text {
    color: #5f7188;
  }

  :global(html:not(.dark)) .folder-actions-popover {
    background: #ffffff;
    border-color: #d8e2ef;
  }

  :global(html:not(.dark)) .folder-action-item {
    color: #0f172a;
  }

  :global(html:not(.dark)) .folder-action-item:hover {
    background: #eef5fc;
  }

  :global(html:not(.dark)) .folder-action-item.danger {
    color: #dc2626;
  }

  :global(html:not(.dark)) .uploader-name,
  :global(html:not(.dark)) .folder-path-badge,
  :global(html:not(.dark)) .type-badge {
    color: #334155;
  }

  /* Delete Modal Styles */
  .delete-modal {
    box-shadow: 0 25px 40px rgba(0, 0, 0, 0.3);
  }

  .delete-modal .modal-header {
    flex-direction: column;
    align-items: center;
    gap: 12px;
    position: relative;
    padding-bottom: 1.25rem;
  }

  .delete-modal .close-btn {
    position: absolute;
    top: 1.5rem;
    right: 1.5rem;
  }

  .delete-modal .modal-header h2 {
    margin: 0;
    text-align: center;
  }

  .delete-icon-container {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: rgba(239, 68, 68, 0.1);
    border: 2px solid rgba(239, 68, 68, 0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ef4444;
    margin-top: 0.5rem;
  }

  :global(.dark) .delete-icon-container {
    background: rgba(239, 68, 68, 0.15);
    border-color: rgba(239, 68, 68, 0.4);
    color: #fda4af;
  }

  :global(html:not(.dark)) .delete-icon-container {
    background: rgba(239, 68, 68, 0.08);
    border-color: rgba(239, 68, 68, 0.25);
    color: #dc2626;
  }

  .delete-modal .confirmation-content {
    text-align: center;
  }

  .delete-modal .confirmation-content p {
    margin: 0;
    font-size: 0.95rem;
  }

  .delete-modal .confirmation-content p:first-child {
    margin-bottom: 0.75rem;
    font-weight: 500;
  }

  .delete-modal .warning-text {
    font-size: 0.9rem;
    margin: 0;
    opacity: 0.85;
  }

  /* Folder Delete Modal with Documents */
  .folder-delete-modal {
    max-width: 650px;
    max-height: 80vh;
  }

  .folder-documents-section {
    margin-top: 1.5rem;
    padding: 1rem;
    background: var(--ims-ref-surface2, rgba(0, 0, 0, 0.02));
    border-radius: 10px;
    border: 1px solid var(--ims-ref-border, rgba(0, 0, 0, 0.1));
  }

  .documents-action-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .document-action-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem;
    background: var(--ims-ref-surface, white);
    border: 1px solid var(--ims-ref-border, #e5e7eb);
    border-radius: 8px;
  }

  .document-info {
    flex: 1;
    min-width: 0;
  }

  .doc-name {
    display: block;
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--ims-ref-text);
    word-break: break-word;
    white-space: normal;
  }

  .action-buttons {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    flex-shrink: 0;
  }

  .action-btn {
    padding: 0.5rem 0.7rem;
    border: 1px solid transparent;
    border-radius: 6px;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
    background: var(--ims-ref-surface2, #f3f4f6);
    color: var(--ims-ref-text3, #6b7280);
    flex-shrink: 0;
  }

  .action-btn:hover {
    background: var(--ims-ref-surface3, #e5e7eb);
  }

  .action-btn.active {
    font-weight: 700;
    border-color: currentColor;
  }

  .action-btn.move-btn.active {
    background: rgba(34, 197, 94, 0.15);
    color: #16a34a;
    border-color: #16a34a;
  }

  .action-btn.duplicate-btn.active {
    background: rgba(59, 130, 246, 0.15);
    color: #2563eb;
    border-color: #2563eb;
  }

  .action-btn.delete-btn.active {
    background: rgba(239, 68, 68, 0.15);
    color: #dc2626;
    border-color: #dc2626;
  }

  .delete-modal .modal-footer {
    display: flex;
    justify-content: center;
    gap: 12px;
    flex-wrap: wrap;
    align-items: center;
    padding: 1.5rem;
  }

  .delete-modal .btn-secondary {
    min-width: 120px;
    flex: 0 1 auto;
  }

  .delete-modal .btn-danger {
    min-width: 160px;
    flex: 0 1 auto;
  }

  /* Folder Action Buttons */
  .folder-action-buttons {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    flex-wrap: nowrap;
    align-items: center;
  }

  .folder-action-btn {
    padding: 0.6rem 0.9rem;
    border: 1px solid transparent;
    border-radius: 6px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
    background: var(--ims-ref-surface2, #f3f4f6);
    color: var(--ims-ref-text3, #6b7280);
    flex-shrink: 0;
  }

  .folder-action-btn:hover:not(:disabled) {
    background: var(--ims-ref-surface3, #e5e7eb);
  }

  .folder-action-btn.active {
    font-weight: 700;
    border: 1px solid currentColor;
    background: rgba(59, 130, 246, 0.1);
    color: #2563eb;
  }

  .folder-action-btn.delete.active {
    background: rgba(239, 68, 68, 0.1);
    color: #dc2626;
    border-color: #dc2626;
  }

  .folder-action-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* Folder action bar in top controls */
  .folder-action-bar {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-danger:disabled {
    background: #dc2626;
    opacity: 0.75;
  }

  .btn-secondary:disabled {
    opacity: 0.6;
  }

  .spinning-icon {
    animation: spin 1s linear infinite;
    display: inline-block;
    transform-origin: center;
  }

  /* Upload modal polish (scoped to upload modal only) */
  .modal-upload {
    max-width: 780px;
    border-radius: 14px;
  }

  .modal-upload .modal-header {
    padding: 1.25rem 1.5rem;
  }

  .modal-upload .modal-header h2 {
    font-size: 1.45rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .modal-upload .modal-upload-body {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.2rem 1.5rem;
  }

  .modal-upload .upload-folder-section {
    margin: 0;
    padding: 0.9rem;
    border-radius: 12px;
    border: 1px solid rgba(148, 163, 184, 0.2);
    background: rgba(15, 23, 42, 0.34);
  }

  .modal-upload .label-heading {
    display: inline-block;
    margin-bottom: 0.65rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: #dbe7ff;
  }

  .modal-upload .folder-search-wrapper {
    height: 42px;
    border-radius: 10px;
    padding: 0 0.75rem;
    background: rgba(30, 41, 59, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.25);
  }

  .modal-upload .folder-grid {
    margin-bottom: 0;
    grid-template-columns: repeat(auto-fill, minmax(146px, 1fr));
    gap: 0.65rem;
  }

  .modal-upload .folder-card {
    min-height: 92px;
    border-radius: 12px;
    border: 1px solid rgba(148, 163, 184, 0.3);
    background: rgba(15, 23, 42, 0.4);
  }

  .modal-upload .folder-card:hover {
    border-color: rgba(56, 189, 248, 0.75);
    background: rgba(14, 116, 144, 0.22);
  }

  .modal-upload .folder-card.active {
    border-color: rgba(96, 165, 250, 0.95);
    background: linear-gradient(135deg, rgba(59, 130, 246, 0.3), rgba(37, 99, 235, 0.24));
  }

  .modal-upload .upload-dropzone {
    border-radius: 12px;
    padding: 2rem 1.4rem;
    border: 1px dashed rgba(125, 211, 252, 0.7);
    background: rgba(15, 23, 42, 0.36);
  }

  .modal-upload .upload-label {
    gap: 0.65rem;
  }

  .modal-upload .upload-label p {
    font-size: 1rem;
    font-weight: 700;
  }

  .modal-upload .upload-label span {
    font-size: 0.92rem;
  }

  .modal-upload .file-hint {
    font-size: 0.86rem;
    font-weight: 600;
  }

  .modal-upload .modal-footer {
    padding: 0.95rem 1.5rem 1.2rem;
  }

  .modal-upload .btn-secondary {
    min-width: 116px;
  }

  :global(html:not(.dark)) .modal-upload .upload-folder-section {
    border-color: #d8e2ef;
    background: #f8fbff;
  }

  :global(html:not(.dark)) .modal-upload .label-heading {
    color: #0f172a;
  }

  :global(html:not(.dark)) .modal-upload .folder-search-wrapper {
    background: #eef5fc;
    border-color: #d8e2ef;
  }

  :global(html:not(.dark)) .modal-upload .folder-card {
    background: #ffffff;
    border-color: #d8e2ef;
    color: #0f172a;
  }

  :global(html:not(.dark)) .modal-upload .folder-card:hover {
    background: #edf4ff;
    border-color: #93c5fd;
  }

  :global(html:not(.dark)) .modal-upload .folder-card.active {
    background: #dbeafe;
    border-color: #60a5fa;
    color: #0f172a;
  }

  :global(html:not(.dark)) .modal-upload .upload-dropzone {
    background: #f6faff;
    border-color: #93c5fd;
  }

  @media (max-width: 640px) {
    .modal-upload {
      width: 96%;
      max-width: 96%;
      border-radius: 12px;
    }

    .modal-upload .modal-header,
    .modal-upload .modal-upload-body,
    .modal-upload .modal-footer {
      padding-left: 0.9rem;
      padding-right: 0.9rem;
    }

    .modal-upload .folder-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  /* Create folder modal polish */
  .modal-folder-create {
    max-width: 560px;
    border-radius: 14px;
  }

  .modal-folder-create .modal-header {
    padding: 1.2rem 1.4rem;
  }

  .modal-folder-create .modal-header h2 {
    font-size: 1.55rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .modal-folder-create .modal-folder-create-body {
    padding: 1.2rem 1.4rem 1rem;
  }

  .modal-folder-create .folder-create-form-group {
    margin: 0;
    padding: 0.9rem;
    border-radius: 12px;
    border: 1px solid rgba(148, 163, 184, 0.2);
    background: rgba(15, 23, 42, 0.3);
  }

  .modal-folder-create .folder-create-form-group label {
    font-size: 0.96rem;
    font-weight: 700;
    color: #dbe7ff;
  }

  .modal-folder-create .folder-create-form-group input {
    height: 46px;
    border-radius: 10px;
    border: 1px solid rgba(148, 163, 184, 0.25);
    background: rgba(30, 41, 59, 0.82);
  }

  .modal-folder-create .folder-create-form-group input::placeholder {
    color: #7f93ad;
  }

  .modal-folder-create .modal-footer {
    padding: 0.9rem 1.4rem 1.2rem;
  }

  .modal-folder-create .btn-secondary {
    min-width: 96px;
  }

  .modal-folder-create .btn-primary {
    min-width: 146px;
  }

  :global(html:not(.dark)) .modal-folder-create .folder-create-form-group {
    border-color: #d8e2ef;
    background: #f8fbff;
  }

  :global(html:not(.dark)) .modal-folder-create .folder-create-form-group label {
    color: #0f172a;
  }

  :global(html:not(.dark)) .modal-folder-create .folder-create-form-group input {
    background: #eef5fc;
    border-color: #d8e2ef;
    color: #0f172a;
  }

  :global(html:not(.dark)) .modal-folder-create .folder-create-form-group input::placeholder {
    color: #6b7f98;
  }

  @media (max-width: 640px) {
    .modal-folder-create {
      width: 94%;
      max-width: 94%;
      border-radius: 12px;
    }

    .modal-folder-create .modal-header,
    .modal-folder-create .modal-folder-create-body,
    .modal-folder-create .modal-footer {
      padding-left: 0.9rem;
      padding-right: 0.9rem;
    }
  }

  .modal-title-stack {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .modal-title-stack p {
    margin: 0;
    font-size: 0.82rem;
    line-height: 1.35;
    font-weight: 500;
    color: #8ea1bb;
  }

  .modal-upload .modal-header,
  .modal-folder-create .modal-header {
    align-items: flex-start;
  }

  :global(html:not(.dark)) .modal-title-stack p {
    color: #5f7188;
  }
  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
</style>
