"use client";

import type { KeyboardEventHandler } from "react";

export function SearchField({
  value,
  placeholder,
  label,
  onChange,
  onFocus,
  onKeyDown,
  controls,
  expanded,
  activeDescendant,
}: {
  value: string;
  placeholder: string;
  label: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  controls?: string;
  expanded?: boolean;
  activeDescendant?: string;
}) {
  return (
    <input
      type="search"
      className="search-field"
      value={value}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      aria-label={label}
      role="combobox"
      aria-autocomplete="list"
      aria-controls={controls}
      aria-expanded={expanded}
      aria-activedescendant={activeDescendant}
      data-gramm="false"
      data-gramm_editor="false"
      data-enable-grammarly="false"
      data-deepl-write-ignore="true"
      onFocus={onFocus}
      onChange={(event) => onChange(event.currentTarget.value)}
      onKeyDown={onKeyDown}
    />
  );
}
