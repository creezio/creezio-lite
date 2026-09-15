export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  stayLoggedIn: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AuthSession = {
  id: string;
  userId: string;
  token: string;
  expiresAt: string | null;
  createdAt: string;
  user: AuthUser;
};

export type AuthRegisterInput = {
  email: string;
  password: string;
  displayName?: string;
};

export type AuthLoginInput = {
  email: string;
  password: string;
  stayLoggedIn?: boolean;
};

export type AuthAccountPublic = {
  id: string;
  email: string;
  displayName: string;
  stayLoggedIn: boolean;
};

export type AuthStore = {
  register(input: AuthRegisterInput): Promise<AuthUser>;
  login(input: AuthLoginInput): Promise<AuthSession>;
  logout(token: string): Promise<boolean>;
  getSession(token: string): Promise<AuthSession | null>;
  getAccount(token: string): Promise<AuthAccountPublic | null>;
  changePassword(input: {
    token: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<boolean>;
  setStayLoggedIn(token: string, value: boolean): Promise<boolean>;
};
