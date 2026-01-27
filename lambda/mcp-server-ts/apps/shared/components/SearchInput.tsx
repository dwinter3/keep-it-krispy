import React, { useState, useEffect, useRef } from 'react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  autoFocus?: boolean;
}

export function SearchInput({ value, onChange, placeholder = 'Search...', debounceMs = 300, autoFocus }: SearchInputProps) {
  const [local, setLocal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => { setLocal(value); }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setLocal(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(v), debounceMs);
  };

  return (
    <div style={{ position: 'relative' }}>
      <input
        type="text"
        value={local}
        onChange={handleChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
        style={{
          width: '100%',
          padding: '8px 12px',
          paddingRight: local ? 32 : 12,
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius)',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
          fontSize: '1rem',
          outline: 'none',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
      />
      {local && (
        <button
          onClick={() => { setLocal(''); onChange(''); }}
          style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            width: 20, height: 20, borderRadius: '50%',
            background: 'var(--text-muted)', color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.7rem',
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
