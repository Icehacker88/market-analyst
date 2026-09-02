import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthModal } from "./auth-modal";

const auth = {
  user: { email: "user@example.com", name: "User" },
  loading: false,
  configured: true,
  googleEnabled: true,
  appleEnabled: false,
  signupEnabled: true,
  callbackMessage: "",
  clearCallbackMessage: vi.fn(),
  loginWithEmail: vi.fn(),
  signupWithEmail: vi.fn(),
  loginWithGoogle: vi.fn(),
  loginWithApple: vi.fn(),
  deleteAccount: vi.fn(),
  signOut: vi.fn(),
};

vi.mock("./auth-provider", () => ({ useAuth: () => auth }));
vi.mock("./providers", () => ({
  useApp: () => ({ language: "en", t: (key: string) => key }),
}));

describe("AuthModal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("closes when the user presses outside the dialog", () => {
    const onClose = vi.fn();
    render(<AuthModal open onClose={onClose} />);

    fireEvent.pointerDown(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
