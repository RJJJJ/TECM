export type NotificationCleanupStep = {
  resource: string;
  stage: string;
  run: () => Promise<void>;
};

export type PushDeviceCleanupTarget = {
  organizationId: string;
  userId: string;
  installationId: string;
};

type PushDeviceFilterBuilder = {
  eq: (column: string, value: string) => PushDeviceFilterBuilder;
};

type PushDeviceCleanupService = {
  from: (table: string) => {
    delete: () => PushDeviceFilterBuilder;
  };
};

export type SanitizedCleanupFailure = {
  resource: string;
  stage: string;
};

export class NotificationCleanupError extends Error {
  readonly failures: SanitizedCleanupFailure[];

  constructor(failures: SanitizedCleanupFailure[]) {
    super(`notification cleanup failed: ${failures.map(({ resource, stage }) => `${resource}/${stage}`).join(', ')}`);
    this.name = 'NotificationCleanupError';
    this.failures = failures;
  }
}

export function buildPushDeviceCleanupSteps(
  service: PushDeviceCleanupService,
  targets: PushDeviceCleanupTarget[]
): NotificationCleanupStep[] {
  return targets.map((target) => ({
    resource: 'push_devices',
    stage: 'delete',
    run: async () => {
      const query = service
        .from('push_devices')
        .delete()
        .eq('organization_id', target.organizationId)
        .eq('user_id', target.userId)
        .eq('installation_id', target.installationId);
      const { error } = await (query as unknown as Promise<{ error: unknown }>);
      if (error) throw error;
    }
  }));
}

async function runWithTimeout(run: () => Promise<void>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('cleanup timeout')), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runBestEffortNotificationCleanup(
  steps: NotificationCleanupStep[],
  { timeoutMs = 15_000 }: { timeoutMs?: number } = {}
) {
  const failures: SanitizedCleanupFailure[] = [];

  for (const step of steps) {
    try {
      await runWithTimeout(step.run, timeoutMs);
    } catch {
      failures.push({ resource: step.resource, stage: step.stage });
    }
  }

  if (failures.length > 0) throw new NotificationCleanupError(failures);
}
