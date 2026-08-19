import React, { useState } from 'react';

import { NeonButton } from '../../../components/neon/NeonButton';
import { useTranslation } from '../../../i18n';
import { useImageStudioStore } from '../store/imageStudioStore';

export const ImageStudioToolbar: React.FC = () => {
  const { t } = useTranslation();
  const {
    currentDocument,
    dirty,
    saved,
    isLoading,
    loadingMessage,
    setLoading,
  } = useImageStudioStore();
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const handleNew = async (): Promise<void> => {
    setLoading(true);
    try {
      const document = await window.knouxImageStudioAPI.create({
        title: 'Untitled',
        width: 1920,
        height: 1080,
        backgroundMode: 'checkerboard',
      });
      useImageStudioStore.getState().setCurrentDocument(document);
      useImageStudioStore.getState().setDocumentPath(null);
      useImageStudioStore.getState().setDirty(false);
    } catch (error) {
      useImageStudioStore.getState().addError(
        error instanceof Error ? error.message : t('imageStudio.createFailed')
      );
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = async (): Promise<void> => {
    if (!window.knouxAPI.file) return;
    setLoading(true);
    try {
      const filePath = await window.knouxAPI.file.openFile({
        title: t('imageStudio.openDocument'),
        filters: [{ name: 'KNOUX Image', extensions: ['knouximage'] }],
        properties: ['openFile'],
      });
      if (!filePath) return;
      const document = await window.knouxImageStudioAPI.open(filePath);
      if (document) {
        useImageStudioStore.getState().setCurrentDocument(document);
        useImageStudioStore.getState().setDocumentPath(filePath);
        useImageStudioStore.getState().setDirty(false);
      }
    } catch (error) {
      useImageStudioStore.getState().addError(
        error instanceof Error ? error.message : t('imageStudio.openFailed')
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (): Promise<void> => {
    const state = useImageStudioStore.getState();
    const path = state.documentPath;
    if (!path || !currentDocument) return;
    setLoading(true);
    try {
      await window.knouxImageStudioAPI.save(path);
      state.setDirty(false);
      state.setSaved(true);
    } catch (error) {
      state.addError(
        error instanceof Error ? error.message : t('imageStudio.saveFailed')
      );
      state.setSaved(false);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAs = async (): Promise<void> => {
    if (!window.knouxAPI.file) return;
    const state = useImageStudioStore.getState();
    setLoading(true);
    try {
      const filePath = await window.knouxAPI.file.saveFile({
        title: t('imageStudio.saveAs'),
        defaultPath: 'untitled.knouximage',
        filters: [{ name: 'KNOUX Image', extensions: ['knouximage'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (!filePath) return;
      await window.knouxImageStudioAPI.saveAs(filePath);
      state.setDocumentPath(filePath);
      state.setDirty(false);
      state.setSaved(true);
    } catch (error) {
      useImageStudioStore.getState().addError(
        error instanceof Error ? error.message : t('imageStudio.saveFailed')
      );
      useImageStudioStore.getState().setSaved(false);
    } finally {
      setLoading(false);
    }
  };

  const handleImportImage = async (): Promise<void> => {
    if (!window.knouxAPI.file) return;
    setLoading(true);
    try {
      const filePath = await window.knouxAPI.file.openFile({
        title: t('imageStudio.importImage'),
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
        properties: ['openFile'],
      });
      if (!filePath) return;
      const document = await window.knouxImageStudioAPI.importImage(filePath);
      useImageStudioStore.getState().setCurrentDocument(document);
      useImageStudioStore.getState().setDirty(true);
    } catch (error) {
      useImageStudioStore.getState().addError(
        error instanceof Error ? error.message : t('imageStudio.operationFailed')
      );
    } finally {
      setLoading(false);
    }
  };

  const handleImportAsLayer = async (): Promise<void> => {
    if (!window.knouxAPI.file) return;
    setLoading(true);
    try {
      const filePath = await window.knouxAPI.file.openFile({
        title: t('imageStudio.importAsLayer'),
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
        properties: ['openFile'],
      });
      if (!filePath) return;
      const document = await window.knouxImageStudioAPI.importAsLayer(filePath);
      useImageStudioStore.getState().setCurrentDocument(document);
      useImageStudioStore.getState().setDirty(true);
    } catch (error) {
      useImageStudioStore.getState().addError(
        error instanceof Error ? error.message : t('imageStudio.operationFailed')
      );
    } finally {
      setLoading(false);
    }
  };

  const handleExportFlattened = async (): Promise<void> => {
    if (!currentDocument) return;
    setLoading(true);
    try {
       const result = await window.knouxImageStudioAPI.exportFlattened({
         format: 'png',
         quality: 0.94,
         width: currentDocument.canvas.width,
         height: currentDocument.canvas.height,
         mime: 'image/png',
         extension: 'png',
         preserveAlpha: true,
         scaleX: 1,
         scaleY: 1,
         upscale: false,
       });
      if (result && result.bytes) {
        useImageStudioStore.getState().setDirty(false);
        useImageStudioStore.getState().setSaved(true);
      }
    } catch (error) {
      useImageStudioStore.getState().addError(
        error instanceof Error ? error.message : t('imageStudio.exportFailed')
      );
    } finally {
      setLoading(false);
    }
  };

  const handleClose = async (): Promise<void> => {
    const state = useImageStudioStore.getState();
    if (state.dirty) {
      setShowCloseConfirm(true);
      return;
    }
    state.reset();
  };

  const handleCloseConfirm = (): void => {
    setShowCloseConfirm(false);
    useImageStudioStore.getState().reset();
  };

  const handleCloseCancel = (): void => {
    setShowCloseConfirm(false);
  };

  const canSave = !!currentDocument && !!useImageStudioStore.getState().documentPath;
  const canExport = !!currentDocument;

  return (
    <div className="image-studio-toolbar" role="toolbar" aria-label={t('imageStudio.documentOperations')}>
      <NeonButton variant="primary" size="sm" onClick={() => void handleNew()} disabled={isLoading}>{t('imageStudio.newDocument')}</NeonButton>
      <NeonButton variant="secondary" size="sm" onClick={() => void handleOpen()} disabled={isLoading}>{t('imageStudio.openDocument')}</NeonButton>
      <NeonButton variant="secondary" size="sm" onClick={() => void handleSave()} disabled={isLoading || !canSave}>{t('common.save')}</NeonButton>
      <NeonButton variant="secondary" size="sm" onClick={() => void handleSaveAs()} disabled={isLoading || !currentDocument}>{t('imageStudio.saveAs')}</NeonButton>
      <NeonButton variant="secondary" size="sm" onClick={() => void handleImportImage()} disabled={isLoading}>{t('imageStudio.importImage')}</NeonButton>
      <NeonButton variant="secondary" size="sm" onClick={() => void handleImportAsLayer()} disabled={isLoading}>{t('imageStudio.importAsLayer')}</NeonButton>
      <NeonButton variant="primary" size="sm" onClick={() => void handleExportFlattened()} disabled={isLoading || !canExport}>{t('imageStudio.exportFlattened')}</NeonButton>
      <NeonButton variant="ghost" size="sm" onClick={() => void handleClose()} disabled={isLoading}>{t('imageStudio.closeDocument')}</NeonButton>
      {isLoading && <span className="image-studio-loading">{loadingMessage || t('common.loading')}</span>}
      {dirty && <span className="image-studio-dirty" aria-live="polite">{t('imageStudio.unsavedChanges')}</span>}
      {saved && currentDocument && <span className="image-studio-saved" aria-live="polite">{t('imageStudio.saved')}</span>}
      {showCloseConfirm && (
        <div className="image-studio-confirm" role="dialog" aria-label={t('imageStudio.closeConfirm')}>
          <span>{t('imageStudio.unsavedChanges')}</span>
          <NeonButton variant="primary" size="sm" onClick={() => void handleCloseConfirm()}>{t('common.ok')}</NeonButton>
          <NeonButton variant="ghost" size="sm" onClick={() => void handleCloseCancel()}>{t('common.cancel')}</NeonButton>
        </div>
      )}
    </div>
  );
};