import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthModal } from "./auth-modal";
import { ApiError } from "@/lib/api";
import type { AuthUser } from "@/lib/types";
const auth={user:null as AuthUser|null, loading:false,configured:true,googleEnabled:false,appleEnabled:false,signupEnabled:true,passwordEnabled:true,turnstileSiteKey:"synthetic",callbackMessage:"",clearCallbackMessage:vi.fn(),loginWithEmail:vi.fn(),signupWithEmail:vi.fn(),loginWithGoogle:vi.fn(),loginWithApple:vi.fn(),deleteAccount:vi.fn(),signOut:vi.fn()};
vi.mock("./auth-provider",()=>({useAuth:()=>auth}));
vi.mock("./providers",()=>({useApp:()=>({language:"en",t:(k:string)=>k})}));
vi.mock("./auth-challenge",()=>({AuthChallenge:({onToken}:{onToken:(value:string)=>void})=><button type="button" onClick={()=>onToken("synthetic-token")}>Complete challenge</button>}));
beforeEach(()=>{vi.resetAllMocks();auth.user=null;auth.passwordEnabled=true;auth.signupEnabled=true;});
describe("password auth UI",()=>{
  it("keeps unvalidated registration and password sign-in disabled",()=>{
    auth.passwordEnabled=false;auth.signupEnabled=false;render(<AuthModal open onClose={vi.fn()}/>);
    expect(screen.getByRole("button",{name:"createAccount"})).toBeDisabled();
    expect(screen.getByText("Email and password sign-in is not enabled yet.")).toBeInTheDocument();
    expect(document.querySelector('button[type="submit"]')).toBeDisabled();
  });
  it("requires a challenge, submits its token, and does not claim success on invalid credentials",async()=>{
    auth.loginWithEmail.mockRejectedValue(new ApiError("invalid",401));const close=vi.fn();render(<AuthModal open onClose={close}/>);
    expect(document.querySelector('button[type="submit"]')).toBeDisabled();
    fireEvent.change(screen.getByLabelText("email"),{target:{value:"synthetic@example.test"}});
    fireEvent.change(screen.getByLabelText("password"),{target:{value:"synthetic password"}});
    fireEvent.click(screen.getByText("Complete challenge"));
    fireEvent.submit(document.querySelector("form")!);
    await screen.findByText("invalidLogin");expect(close).not.toHaveBeenCalled();
    expect(auth.loginWithEmail).toHaveBeenCalledWith("synthetic@example.test","synthetic password","synthetic-token");
    expect(document.querySelector('button[type="submit"]')).toBeDisabled();
  });
  it("does not tell a newly created unverified account that a verification email was sent",async()=>{
    auth.signupWithEmail.mockResolvedValue({id:"new",email:"synthetic@example.test"});const close=vi.fn();render(<AuthModal open onClose={close}/>);
    fireEvent.click(screen.getByRole("button",{name:"createAccount"}));
    expect(screen.getByLabelText("password")).toHaveAttribute("minlength","15");
    fireEvent.change(screen.getByLabelText("email"),{target:{value:"synthetic@example.test"}});
    fireEvent.change(screen.getByLabelText("password"),{target:{value:"synthetic password"}});
    fireEvent.click(screen.getByText("Complete challenge"));fireEvent.submit(document.querySelector("form")!);
    await waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(screen.queryByText("checkEmail")).not.toBeInTheDocument();
  });
  it("shows failed logout without closing the account dialog",async()=>{
    auth.user={id:"original",email:"synthetic@example.test"};auth.signOut.mockRejectedValue(new Error("Offline"));const close=vi.fn();render(<AuthModal open onClose={close}/>);
    fireEvent.click(screen.getByRole("button",{name:"logout"}));await screen.findByText("Sign out could not be confirmed. Please retry.");expect(close).not.toHaveBeenCalled();
  });
});
