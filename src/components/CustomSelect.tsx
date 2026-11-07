import React, { useState, useRef, useEffect, useMemo, useId, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, Search, X } from 'lucide-react';
import { cn } from '../lib/utils';

export interface SelectOption {
  value: string | number;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface CustomSelectProps {
  id?: string;
  name?: string;
  value?: string | number | null;
  onChange: (value: string) => void;
  options?: SelectOption[];
  children?: React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  dropdownClassName?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  'aria-label'?: string;
  title?: string;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  id,
  name,
  value,
  onChange,
  options,
  children,
  placeholder = 'Выберите...',
  disabled = false,
  className,
  dropdownClassName,
  searchable,
  searchPlaceholder = 'Поиск...',
  'aria-label': ariaLabel,
  title,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectId = useId();
  const actualId = id || selectId;

  // Extract options from props.options or props.children (<option>)
  const parsedOptions = useMemo<SelectOption[]>(() => {
    if (options && options.length > 0) return options;
    const items: SelectOption[] = [];
    React.Children.forEach(children, (child) => {
      if (React.isValidElement(child)) {
        const props = child.props as { value?: string | number; children?: React.ReactNode; disabled?: boolean };
        items.push({
          value: props.value !== undefined ? props.value : '',
          label: props.children ?? '',
          disabled: Boolean(props.disabled),
        });
      }
    });
    return items;
  }, [options, children]);

  // Current selected option
  const selectedOption = useMemo(() => {
    const stringVal = value !== undefined && value !== null ? String(value) : '';
    return parsedOptions.find((opt) => String(opt.value) === stringVal);
  }, [parsedOptions, value]);

  // Automatically enable search if there are >= 8 items unless explicitly disabled
  const isSearchable = searchable ?? (parsedOptions.length >= 8);

  // Filtered options based on search query
  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return parsedOptions;
    const q = searchQuery.toLowerCase().trim();
    return parsedOptions.filter((opt) => {
      if (typeof opt.label === 'string') {
        return opt.label.toLowerCase().includes(q);
      }
      if (typeof opt.label === 'number') {
        return String(opt.label).includes(q);
      }
      return String(opt.value).toLowerCase().includes(q);
    });
  }, [parsedOptions, searchQuery]);

  // Positioning coordinates for fixed portal
  const [coords, setCoords] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
    placement: 'bottom' | 'top';
  } | null>(null);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    const placeTop = spaceBelow < 220 && spaceAbove > spaceBelow;

    // Minimum width is 190px or button width, capped to screen width minus margin
    const menuWidth = Math.min(viewportWidth - 20, Math.max(rect.width, 190));
    let left = rect.left;
    if (left + menuWidth > viewportWidth - 10) {
      left = Math.max(10, viewportWidth - menuWidth - 10);
    }
    if (left < 10) left = 10;

    const maxHeight = Math.min(300, Math.max(160, (placeTop ? spaceAbove : spaceBelow) - 16));

    setCoords({
      top: placeTop ? undefined : rect.bottom + 6,
      bottom: placeTop ? viewportHeight - rect.top + 6 : undefined,
      left,
      width: menuWidth,
      maxHeight,
      placement: placeTop ? 'top' : 'bottom',
    });
  }, []);

  // Open / Close side-effects
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setHighlightedIndex(-1);
      return;
    }

    updatePosition();

    if (isSearchable) {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }

    const handleScroll = () => {
      updatePosition();
    };

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setIsOpen(false);
    };

    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isOpen, isSearchable, updatePosition]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => {
        const next = prev + 1;
        return next >= filteredOptions.length ? 0 : next;
      });
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => {
        const next = prev - 1;
        return next < 0 ? filteredOptions.length - 1 : next;
      });
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
        const opt = filteredOptions[highlightedIndex];
        if (!opt.disabled) {
          onChange(String(opt.value));
          setIsOpen(false);
          triggerRef.current?.focus();
        }
      }
    }
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const el = listRef.current.children[highlightedIndex] as HTMLElement | undefined;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex]);

  const displayLabel = selectedOption ? selectedOption.label : placeholder;

  return (
    <>
      <button
        ref={triggerRef}
        id={actualId}
        name={name}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        title={title}
        onClick={() => {
          if (!disabled) setIsOpen((prev) => !prev);
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          "relative inline-flex items-center justify-between gap-2 text-left cursor-pointer transition-all duration-150 select-none",
          isOpen && "ring-2 ring-indigo-500/20 border-indigo-500 bg-white shadow-xs",
          className
        )}
      >
        <span className="truncate flex-1 min-w-0 font-medium">{displayLabel}</span>
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 shrink-0 text-slate-400 transition-transform duration-200",
            isOpen && "rotate-180 text-indigo-600"
          )}
        />
      </button>

      {isOpen && coords &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            tabIndex={-1}
            onKeyDown={handleKeyDown}
            style={{
              position: 'fixed',
              top: coords.top !== undefined ? `${coords.top}px` : undefined,
              bottom: coords.bottom !== undefined ? `${coords.bottom}px` : undefined,
              left: `${coords.left}px`,
              width: `${coords.width}px`,
              zIndex: 99999,
            }}
            className={cn(
              "bg-white/95 backdrop-blur-xl border border-slate-200/90 rounded-2xl shadow-2xl shadow-indigo-950/15 ring-1 ring-slate-900/5 p-1.5 flex flex-col text-slate-800 transition-all",
              "animate-in fade-in-0 zoom-in-95 duration-100",
              dropdownClassName
            )}
          >
            {isSearchable && (
              <div className="relative mb-1 pb-1 border-b border-slate-100">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setHighlightedIndex(0);
                  }}
                  placeholder={searchPlaceholder}
                  className="w-full text-xs pl-8 pr-7 py-1.5 bg-slate-50/80 border border-slate-200/80 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white text-slate-800 placeholder:text-slate-400"
                  onClick={(e) => e.stopPropagation()}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      searchInputRef.current?.focus();
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 rounded-md"
                    aria-label="Очистить"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}

            <div
              ref={listRef}
              style={{ maxHeight: `${coords.maxHeight}px` }}
              className="overflow-y-auto space-y-0.5 overscroll-contain select-none p-0.5"
            >
              {filteredOptions.length === 0 ? (
                <div className="py-3 px-2 text-center text-xs text-slate-400">
                  Ничего не найдено
                </div>
              ) : (
                filteredOptions.map((opt, idx) => {
                  const isSelected = selectedOption && String(selectedOption.value) === String(opt.value);
                  const isHighlighted = highlightedIndex === idx;

                  return (
                    <button
                      key={`${opt.value}-${idx}`}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      disabled={opt.disabled}
                      onClick={() => {
                        onChange(String(opt.value));
                        setIsOpen(false);
                        triggerRef.current?.focus();
                      }}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      className={cn(
                        "w-full px-2.5 py-1.5 text-xs rounded-xl flex items-center justify-between text-left transition-all duration-150 cursor-pointer",
                        isSelected
                          ? "bg-indigo-50/90 text-indigo-700 font-semibold"
                          : isHighlighted
                          ? "bg-slate-100/90 text-slate-900"
                          : "text-slate-700 hover:bg-slate-50 hover:text-slate-900",
                        opt.disabled && "opacity-40 cursor-not-allowed pointer-events-none"
                      )}
                    >
                      <span className="truncate pr-2">{opt.label}</span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
