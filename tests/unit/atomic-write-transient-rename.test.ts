import { mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { writeFileAtomic } from '../../electron/fs/atomic-write';

jest.mock('node:fs/promises', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const actual = jest.requireActual('node:fs/promises') as typeof import('node:fs/promises');
  return {
    __esModule: true,
    ...actual,
    rename: jest.fn(actual.rename),
  };
});

const renameMock = rename as unknown as jest.Mock;

describe('writeFileAtomic transient Windows rename contention', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'knoux-atomic-retry-'));
    renameMock.mockClear();
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('retries the atomic rename through transient EPERM/EACCES/EBUSY failures', async () => {
    const actualRename = jest.requireActual('node:fs/promises').rename as typeof rename;
    const transient = (code: string): NodeJS.ErrnoException => Object.assign(new Error(`transient ${code}`), { code });
    renameMock
      .mockRejectedValueOnce(transient('EPERM'))
      .mockRejectedValueOnce(transient('EBUSY'))
      .mockImplementationOnce(actualRename);

    const destination = path.join(directory, 'retried.png');
    const bytes = Buffer.from('retried-atomic-bytes');

    const result = await writeFileAtomic(destination, bytes);

    expect(result.bytesWritten).toBe(bytes.byteLength);
    expect(await readFile(destination)).toEqual(bytes);
    expect(renameMock).toHaveBeenCalledTimes(3);
    const entries = await readdir(directory);
    expect(entries.filter((entry) => entry.endsWith('.tmp'))).toHaveLength(0);
  });

  it('does not retry non-transient rename failures and never touches the destination', async () => {
    const fatal = (): NodeJS.ErrnoException => Object.assign(new Error('fatal rename'), { code: 'ENOSPC' });
    renameMock.mockRejectedValueOnce(fatal());

    const destination = path.join(directory, 'never.png');

    await expect(writeFileAtomic(destination, Buffer.from('data'))).rejects.toThrow('fatal rename');
    expect(renameMock).toHaveBeenCalledTimes(1);
    const entries = await readdir(directory);
    expect(entries.filter((entry) => entry.endsWith('.tmp'))).toHaveLength(0);
  });
});
