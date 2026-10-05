import { describe, expect, test } from "bun:test";

type Service = {
  ports: string[];
  volumes: string[];
  security_opt: string[];
  mem_limit: string;
  privileged?: boolean;
  network_mode?: string;
  logging: { options: Record<string, string> };
  environment: Record<string, string>;
  build?: { context: string };
};

const compose = Bun.YAML.parse(
  await Bun.file(new URL("./docker-compose.yml", import.meta.url)).text(),
) as { services: Record<string, Service> };

describe("local Compose security", () => {
  test("publishes services only on loopback and bounds memory and logs", () => {
    for (const service of Object.values(compose.services)) {
      for (const port of service.ports) {
        expect(port.startsWith("127.0.0.1:")).toBe(true);
      }
      expect(service.mem_limit).toMatch(/^\d+[mg]$/);
      expect(service.logging.options["max-size"]).toBe("10m");
      expect(service.logging.options["max-file"]).toBe("3");
      expect(service.security_opt).toContain("no-new-privileges:true");
      expect(service.privileged).not.toBe(true);
      expect(service.network_mode).not.toBe("host");
      expect(service.volumes.some((volume) => volume.includes("docker.sock"))).toBe(false);
    }
  });

  test("protects host source files and ignores untrusted proxy headers", () => {
    expect(compose.services.bun!.volumes).toContain(".:/app:ro");
    expect(compose.services.bun!.environment.TRUSTED_PROXY_IPS).toBe("");
    expect(compose.services.bun!.environment.NODE_ENV).toBe("development");
  });

  test("keeps captured email storage bounded and disables SMTP authentication", () => {
    expect(compose.services.mailpit!.environment.MP_MAX_MESSAGES).toBe("500");
    expect(compose.services.mailpit!.environment.MP_MAX_MESSAGE_SIZE).toBe("10");
    expect(compose.services.bun!.environment.MAIL_USERNAME).toBe("");
    expect(compose.services.bun!.environment.MAIL_PASSWORD).toBe("");
  });

  test("excludes application secrets from the MinIO build and uses a non-root runtime", async () => {
    expect(compose.services.minio!.build?.context).toBe("./docker/minio");
    const dockerfile = await Bun.file(new URL("./docker/minio/Dockerfile", import.meta.url)).text();
    expect(dockerfile).toMatch(/^USER minio$/m);
    expect(dockerfile).not.toMatch(/^COPY\s+\.\s/m);
    expect(compose.services.minio!.volumes).toEqual(["minio_data:/data"]);
  });
});
