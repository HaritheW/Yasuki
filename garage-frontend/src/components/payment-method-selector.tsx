import { useEffect, useId, useMemo, useRef } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

export const DEFAULT_PAYMENT_METHOD_OPTIONS = ["Cash", "Card", "Bank Transfer", "Online"] as const;

export const PAYMENT_METHOD_OTHER_VALUE = "__other__";
export const PAYMENT_METHOD_NONE_VALUE = "__none__";

type PaymentMethodSelectorProps = {
  value: string;
  onValueChange: (value: string) => void;
  customValue: string;
  onCustomValueChange: (value: string) => void;
  options?: readonly string[];
  includeNotSpecified?: boolean;
  label?: string;
  helperText?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  idPrefix?: string;
  name?: string;
};

const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export const PaymentMethodSelector = ({
  value,
  onValueChange,
  customValue,
  onCustomValueChange,
  options = DEFAULT_PAYMENT_METHOD_OPTIONS,
  includeNotSpecified = false,
  label,
  helperText,
  placeholder = "Enter payment method",
  disabled = false,
  className,
  idPrefix,
  name,
}: PaymentMethodSelectorProps) => {
  const generatedId = useId();
  const baseId = idPrefix ?? `payment-method-${generatedId}`;
  const textInputRef = useRef<HTMLInputElement>(null);

  const optionValues = useMemo(() => {
    return Array.from(new Set(options));
  }, [options]);

  const normalizedSelection =
    value === "" && includeNotSpecified ? PAYMENT_METHOD_NONE_VALUE : value;

  const handleSelectionChange = (nextValue: string) => {
    onValueChange(nextValue);
    if (nextValue !== PAYMENT_METHOD_OTHER_VALUE) {
      onCustomValueChange("");
    }
  };

  const showCustomInput = normalizedSelection === PAYMENT_METHOD_OTHER_VALUE;

  useEffect(() => {
    if (showCustomInput && !disabled) {
      textInputRef.current?.focus();
      textInputRef.current?.select();
    }
  }, [showCustomInput, disabled]);

  const resolvedHiddenValue =
    normalizedSelection === PAYMENT_METHOD_OTHER_VALUE
      ? customValue.trim()
      : normalizedSelection === PAYMENT_METHOD_NONE_VALUE
      ? ""
      : normalizedSelection;

  const optionCardClass =
    "peer sr-only peer-data-[state=checked]:ring-2 peer-data-[state=checked]:ring-primary peer-data-[state=checked]:ring-offset-1";

  const labelCardClass = cn(
    "flex cursor-pointer items-center justify-between rounded-md border border-input bg-card/50 px-3 py-2 text-sm font-medium text-muted-foreground transition hover:border-primary hover:text-foreground",
    "peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 peer-data-[state=checked]:text-primary"
  );

  return (
    <div className={cn("space-y-3", className)}>
      {label && (
        <Label className="text-sm font-semibold text-foreground" htmlFor={`${baseId}-group`}>
          {label}
        </Label>
      )}
      <RadioGroup
        id={`${baseId}-group`}
        value={normalizedSelection}
        onValueChange={handleSelectionChange}
        className={cn(
          "grid gap-3",
          optionValues.length >= 3 ? "sm:grid-cols-3" : optionValues.length === 2 ? "sm:grid-cols-2" : ""
        )}
        disabled={disabled}
      >
        {includeNotSpecified && (
          <div className={cn("flex", disabled && "opacity-50")}>
            <RadioGroupItem
              value={PAYMENT_METHOD_NONE_VALUE}
              id={`${baseId}-${PAYMENT_METHOD_NONE_VALUE}`}
              className={optionCardClass}
              disabled={disabled}
            />
            <Label
              htmlFor={`${baseId}-${PAYMENT_METHOD_NONE_VALUE}`}
              className={cn(labelCardClass, "flex-1")}
            >
              Not specified
            </Label>
          </div>
        )}
        {optionValues.map((option) => {
          const optionId = `${baseId}-${slugify(option)}`;
          return (
            <div key={option} className={cn("flex", disabled && "opacity-50")}>
              <RadioGroupItem
                value={option}
                id={optionId}
                className={optionCardClass}
                disabled={disabled}
              />
              <Label htmlFor={optionId} className={cn(labelCardClass, "flex-1")}>
                {option}
              </Label>
            </div>
          );
        })}
        <div className={cn("flex", disabled && "opacity-50")}>
          <RadioGroupItem
            value={PAYMENT_METHOD_OTHER_VALUE}
            id={`${baseId}-${PAYMENT_METHOD_OTHER_VALUE}`}
            className={optionCardClass}
            disabled={disabled}
          />
          <Label
            htmlFor={`${baseId}-${PAYMENT_METHOD_OTHER_VALUE}`}
            className={cn(labelCardClass, "flex-1")}
          >
            Other
          </Label>
        </div>
      </RadioGroup>
      {showCustomInput && (
        <Input
          ref={textInputRef}
          placeholder={placeholder}
          value={customValue}
          onChange={(event) => onCustomValueChange(event.target.value)}
          disabled={disabled}
        />
      )}
      {helperText && (
        <p className="text-xs text-muted-foreground">
          {helperText}
        </p>
      )}
      {name && <input type="hidden" name={name} value={resolvedHiddenValue} />}
    </div>
  );
};

export type PaymentMethodOption = (typeof DEFAULT_PAYMENT_METHOD_OPTIONS)[number];


