import { UserPersona, UserProfile } from "@/types";

export type MembershipType = "IEEE" | "AEROBOTIX" | "EXTERNAL";

export interface RegisterMemberInput {
  firstName?: string;
  lastName?: string;
  name: string;
  email: string;
  membership: MembershipType;
  phone: string;
}

export interface RegisterResult {
  persona: UserPersona;
  profile: UserProfile;
}

export interface IAuthService {
  registerMember(input: RegisterMemberInput): Promise<RegisterResult>;
  getCurrentUser(): UserPersona;
  getCurrentSession(): Promise<UserPersona | null>;
  clearSession(): void;
  subscribeSession(callback: (persona: UserPersona) => void): () => void;
}
