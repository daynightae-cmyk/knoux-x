import React, { useState } from 'react';

import { NeonButton } from '../../../components/neon/NeonButton';
import { NeonInput } from '../../../components/neon/NeonInput';
import { NeonSelect } from '../../../components/neon/NeonSelect';
import { useTranslation } from '../../../i18n';
import { useImageStudioStore } from '../store/imageStudioStore';

export const ImageStudioCredentialDialog: React.FC = () => {
  const { t } = useTranslation();
  const { setProviderStatus } = useImageStudioStore();
  const [provider, setProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [scopes, setScopes] = useState('');
  const [isConfiguring, setIsConfiguring] = useState(false);

  const providerOptions = [
    { value: 'openrouter', label: 'OpenRouter' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'anthropic', label: 'Anthropic' },
    { value: 'stability', label: 'Stability AI' },
    { value: 'replicate', label: 'Replicate' },
  ];

  const handleSetCredential = async (): Promise<void> => {
    if (!provider || !apiKey) return;
    setIsConfiguring(true);
    try {
      const result = await window.knouxImageStudioAPI.setCredential(provider, apiKey, scopes ? scopes.split(',').map((s) => s.trim()) : undefined);
      setProviderStatus(result as Record<string, { id: string; name: string; configured: boolean; healthy: boolean; storageMode: string; keyMasked: string }>);
      setApiKey('');
      setScopes('');
    } catch {
      // silently ignore
    } finally {
      setIsConfiguring(false);
    }
  };

  const handleRemoveCredential = async (): Promise<void> => {
    if (!provider) return;
    try {
      await window.knouxImageStudioAPI.removeCredential(provider);
      const status = await window.knouxImageStudioAPI.providerStatus();
      setProviderStatus(status as Record<string, { id: string; name: string; configured: boolean; healthy: boolean; storageMode: string; keyMasked: string }>);
    } catch {
      // silently ignore
    }
  };

  const handleValidate = async (): Promise<void> => {
    if (!provider || !apiKey) return;
    try {
      await window.knouxImageStudioAPI.validateCredential(provider, apiKey);
    } catch {
      // silently ignore validation errors
    }
  };

  return (
    <div className="image-studio-credential-dialog" role="dialog" aria-label={t('imageStudio.credentialStatus')}>
      <h3>{t('imageStudio.credentialStatus')}</h3>
      <NeonSelect value={provider} onChange={setProvider} options={providerOptions} aria-label={t('imageStudio.provider')} />
      <NeonInput
        type="password"
        value={apiKey}
         onChange={(e) => setApiKey(e.target.value)}
        placeholder={t('imageStudio.addCredential')}
        aria-label={t('imageStudio.addCredential')}
      />
      <NeonInput
        value={scopes}
         onChange={(e) => setScopes(e.target.value)}
        placeholder="Scopes (comma-separated)"
        aria-label={t('imageStudio.scopes')}
      />
      <NeonButton variant="primary" size="sm" onClick={() => void handleSetCredential()} disabled={isConfiguring || !provider || !apiKey}>
        {t('imageStudio.addCredential')}
      </NeonButton>
      <NeonButton variant="secondary" size="sm" onClick={() => void handleValidate()} disabled={!provider || !apiKey}>
        {t('common.validate')}
      </NeonButton>
      {provider && (
        <NeonButton variant="ghost" size="sm" onClick={() => void handleRemoveCredential()}>
          {t('imageStudio.removeCredential')}
        </NeonButton>
      )}
    </div>
  );
};