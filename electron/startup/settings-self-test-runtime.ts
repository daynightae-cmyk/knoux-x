export interface SettingsSelfTestApplication {
  whenReady(): Promise<unknown>;
  exit(exitCode: number): void;
}

export type RunSettingsSelfTest = (evidencePath: string) => Promise<void>;

const SETTINGS_SELF_TEST_FLAG = '--settings-self-test';
const SETTINGS_EVIDENCE_PREFIX = '--settings-evidence=';

/**
 * Runs the packaged settings persistence verification when explicitly requested.
 * Returning true guarantees that normal desktop startup must not continue, because
 * the self-test exits the Electron process after writing its evidence.
 */
export async function maybeRunSettingsPersistenceSelfTest(
  argv: readonly string[],
  application: SettingsSelfTestApplication,
  runSelfTest: RunSettingsSelfTest,
): Promise<boolean> {
  if (!argv.includes(SETTINGS_SELF_TEST_FLAG)) return false;

  const evidencePath = argv.find((argument) => argument.startsWith(SETTINGS_EVIDENCE_PREFIX))
    ?.slice(SETTINGS_EVIDENCE_PREFIX.length) ?? '';

  await application.whenReady();
  await runSelfTest(evidencePath);
  application.exit(0);
  return true;
}
