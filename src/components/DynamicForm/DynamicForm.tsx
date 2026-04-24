import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ParamField, VisibleWhen } from "../../types";

export interface DynamicFormProps {
  fields: ParamField[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  className?: string;
  /// Render fields inline (flex row) instead of stacked
  inline?: boolean;
}

/**
 * Convert any JSON value to a string stable enough for use as a Select value.
 * Select components are string-based, so we stringify non-string values and
 * parse them back on change.
 */
function toSelectValue(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  return JSON.stringify(v);
}

function fromSelectValue(stringValue: string, original: unknown): unknown {
  if (typeof original === "string") return stringValue;
  try {
    return JSON.parse(stringValue);
  } catch {
    return stringValue;
  }
}

function checkVisible(cond: VisibleWhen | undefined, values: Record<string, unknown>): boolean {
  if (!cond) return true;
  const current = values[cond.field];
  if (cond.equals !== undefined) {
    return current === cond.equals;
  }
  if (cond.in_values) {
    return cond.in_values.includes(current);
  }
  return true;
}

export function DynamicForm({ fields, values, onChange, className, inline }: DynamicFormProps) {
  return (
    <div
      className={cn(
        inline ? "flex items-end gap-4 flex-wrap" : "flex flex-col gap-3",
        className,
      )}
    >
      {fields.map((field) => {
        if (!checkVisible(field.visible_when, values)) return null;
        return (
          <FieldControl
            key={field.key}
            field={field}
            value={values[field.key] ?? getFieldDefault(field)}
            onChange={(v) => onChange(field.key, v)}
          />
        );
      })}
    </div>
  );
}

function getFieldDefault(field: ParamField): unknown {
  if (field.type === "boolean") return field.default;
  if (field.type === "string") return field.default ?? "";
  return field.default;
}

interface FieldControlProps {
  field: ParamField;
  value: unknown;
  onChange: (v: unknown) => void;
}

function FieldControl({ field, value, onChange }: FieldControlProps) {
  if (field.type === "enum") {
    // Find the option whose stringified value matches
    const currentStr = toSelectValue(value);
    return (
      <div className="space-y-1.5">
        <Label className="text-xs">{field.label}</Label>
        <Select
          value={currentStr}
          onValueChange={(v) => onChange(fromSelectValue(v, field.options[0]?.value))}
        >
          <SelectTrigger className="h-8 min-w-[100px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((opt) => (
              <SelectItem key={toSelectValue(opt.value)} value={toSelectValue(opt.value)}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (field.type === "number") {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs">{field.label}</Label>
        <Input
          type="number"
          min={field.min}
          max={field.max}
          step={field.step}
          value={value === undefined || value === null ? "" : Number(value)}
          onChange={(e) => {
            const n = e.target.value === "" ? "" : Number(e.target.value);
            onChange(n === "" ? null : n);
          }}
          className="h-8 w-24"
        />
      </div>
    );
  }

  if (field.type === "boolean") {
    return (
      <div className="flex items-center gap-2 h-8">
        <Switch
          id={`field-${field.key}`}
          checked={!!value}
          onCheckedChange={(v) => onChange(v)}
        />
        <Label htmlFor={`field-${field.key}`} className="text-xs">
          {field.label}
        </Label>
      </div>
    );
  }

  // string
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{field.label}</Label>
      <Input
        type="text"
        placeholder={field.placeholder ?? ""}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className="h-8"
      />
    </div>
  );
}

/**
 * Given a list of fields, build a values object populated with defaults.
 */
export function defaultsForFields(fields: ParamField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    out[f.key] = getFieldDefault(f);
  }
  return out;
}
