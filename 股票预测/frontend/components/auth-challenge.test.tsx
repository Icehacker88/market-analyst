import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthChallenge } from "./auth-challenge";

afterEach(()=>{delete window.turnstile;});
describe("auth challenge lifecycle",()=>{
  it("passes successful tokens, clears expired tokens, and removes the widget on close",async()=>{
    let options: Parameters<NonNullable<Window["turnstile"]>["render"]>[1];
    const remove=vi.fn(), renderWidget=vi.fn((_element, value)=>{options=value;return "widget";});
    window.turnstile={render:renderWidget,remove};const onToken=vi.fn();
    const view=render(<AuthChallenge siteKey="synthetic" action="login" onToken={onToken} language="en"/>);
    await waitFor(()=>expect(renderWidget).toHaveBeenCalledOnce());
    act(()=>options.callback("synthetic-token"));expect(onToken).toHaveBeenLastCalledWith("synthetic-token");
    act(()=>options["expired-callback"]());expect(onToken).toHaveBeenLastCalledWith("");
    view.unmount();expect(remove).toHaveBeenCalledWith("widget");
    act(()=>options.callback("late-token"));expect(onToken).toHaveBeenLastCalledWith("");
  });
  it("reports errors and retries without accepting an old token",async()=>{
    let options: Parameters<NonNullable<Window["turnstile"]>["render"]>[1];
    const renderWidget=vi.fn((_element,value)=>{options=value;return "widget";});
    window.turnstile={render:renderWidget,remove:vi.fn()};const onToken=vi.fn();
    render(<AuthChallenge siteKey="synthetic" action="signup" onToken={onToken} language="en"/>);
    await waitFor(()=>expect(renderWidget).toHaveBeenCalledOnce());
    act(()=>options["error-callback"]());expect(screen.getByRole("alert")).toHaveTextContent("unavailable");
    expect(onToken).toHaveBeenLastCalledWith("");fireEvent.click(screen.getByText("Retry"));
    await waitFor(()=>expect(renderWidget).toHaveBeenCalledTimes(2));
  });
});
