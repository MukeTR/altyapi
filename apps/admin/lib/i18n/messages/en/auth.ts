import type trAuth from "../tr/auth";

const auth: typeof trAuth = {
  login: {
    title: "Sign in",
    metaTitle: "Sign in",
    subtitle: "Sign in to your store admin.",
    email: "Email",
    password: "Password",
    submit: "Sign in",
    submitting: "Signing in…",
    noAccount: "Don't have an account?",
    createAccount: "Create one",
    expired: "Your session has ended. Please sign in again.",
    loggedOut: "You have signed out.",
  },
  register: {
    title: "Create account",
    metaTitle: "Sign up",
    subtitle: "Set up your store in a few steps.",
    name: "Full name",
    email: "Email",
    password: "Password",
    passwordHint: "At least 10 characters.",
    locale: "Interface language",
    submit: "Create account",
    submitting: "Creating account…",
    haveAccount: "Already have an account?",
    signIn: "Sign in",
    emailTakenAction: "Sign in with this email",
  },
  errors: {
    rateLimited: "Too many attempts. Try again in {seconds} seconds.",
    rateLimitedShort: "Too many attempts. Try again shortly.",
  },
  logout: "Sign out",
};

export default auth;
