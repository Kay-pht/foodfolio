import type { User } from "@prisma/client";

declare module "fastify" {
  interface FastifyRequest {
    firebaseUid: string;
    appUser: User;
  }
}
