import type {
  PlatformConnectionInfo,
  PlatformDriver,
  ProjectDbHandle,
} from './driver.interface.js';

export class DotNetDriverNotImplementedError extends Error {
  constructor() {
    super(
      'DotNetPlatformDriver is not implemented yet; create a PlatformConnection with targetType=NODE.',
    );
    this.name = 'DotNetDriverNotImplementedError';
  }
}

export class DotNetPlatformDriver implements PlatformDriver {
  public readonly targetType = 'DOTNET' as const;
  public readonly connection: PlatformConnectionInfo;

  constructor(connection: PlatformConnectionInfo) {
    this.connection = connection;
  }

  async getProjectDb(): Promise<ProjectDbHandle> {
    throw new DotNetDriverNotImplementedError();
  }

  async invokeAction(): Promise<{ success: false; error: string }> {
    return { success: false, error: 'DotNetPlatformDriver.invokeAction is not implemented' };
  }

  async close(): Promise<void> {
    // no-op
  }
}
