import { useImperativeHandle, useRef, useState, type Ref } from "react";
import {
  HIGHLIGHT_FIELD_LABELS,
  type HighlightField,
  type PlanFieldEdits,
  type PlanRevision,
} from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface CurrentDescriptionHandle {
  /** Opens the details and focuses the editable control for `field`. False if none exists. */
  focusField(field: HighlightField): boolean;
}

type EditableField = "movement" | "count" | "timing" | "magnitude";
const UNSET = "__unset";
const DIRECTIONS = [
  "backward",
  "forward",
  "left",
  "right",
  "up",
  "down",
  "clockwise",
  "counterclockwise",
  "in place",
];
const COUNTS = ["1", "2", "3", "4", "5"];
const MAGNITUDES = ["small", "medium", "large"];

interface FieldValues {
  movement: string;
  count: string;
  timing: string;
  magnitude: string;
}

function valuesFromPlan(plan: PlanRevision): FieldValues {
  const a = plan.plan.selectedAction;
  return {
    movement: a.direction ?? UNSET,
    count: a.repetitions !== null ? String(a.repetitions) : UNSET,
    timing: a.timing ?? "",
    magnitude: a.magnitude ?? UNSET,
  };
}

function textOrNull(value: string): string | null {
  const v = value.trim();
  return v === "" || v === UNSET ? null : v;
}

/**
 * Structured edits for POST plans `fieldEdits`: only changed fields are sent (null clears), so
 * the planner preserves every untouched constraint (spec 6, 9). Null when nothing changed.
 */
export function buildFieldEdits(before: FieldValues, after: FieldValues): PlanFieldEdits | null {
  const edits: PlanFieldEdits = {};
  if (textOrNull(after.movement) !== textOrNull(before.movement)) {
    edits.direction = textOrNull(after.movement);
  }
  if (textOrNull(after.count) !== textOrNull(before.count)) {
    const n = textOrNull(after.count);
    edits.repetitions = n === null ? null : Number.parseInt(n, 10);
  }
  if (textOrNull(after.timing) !== textOrNull(before.timing))
    edits.timing = textOrNull(after.timing);
  if (textOrNull(after.magnitude) !== textOrNull(before.magnitude)) {
    edits.magnitude = textOrNull(after.magnitude);
  }
  return Object.keys(edits).length > 0 ? edits : null;
}

function withCurrent(options: readonly string[], current: string): string[] {
  return current !== UNSET && !options.includes(current) ? [current, ...options] : [...options];
}

interface CurrentDescriptionProps {
  plan: PlanRevision;
  disabled: boolean;
  onSubmit(edits: PlanFieldEdits): void;
  ref?: Ref<CurrentDescriptionHandle>;
}

/** Compact editable view of the stored action plan. Parent keys it by plan id. */
export function CurrentDescription({ plan, disabled, onSubmit, ref }: CurrentDescriptionProps) {
  const initial = valuesFromPlan(plan);
  const [values, setValues] = useState<FieldValues>(initial);
  const [open, setOpen] = useState(false);
  const controls = useRef<Partial<Record<EditableField, HTMLElement | null>>>({});
  const action = plan.plan.selectedAction;
  const edits = buildFieldEdits(initial, values);

  useImperativeHandle(ref, () => ({
    focusField(field) {
      if (
        field !== "movement" &&
        field !== "count" &&
        field !== "timing" &&
        field !== "magnitude"
      ) {
        return false;
      }
      setOpen(true);
      requestAnimationFrame(() => controls.current[field]?.focus());
      return true;
    },
  }));

  function set(field: EditableField, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
  }

  function select(field: "movement" | "count" | "magnitude", options: string[]) {
    return (
      <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2">
        <Label htmlFor={`desc-${field}`} className="text-[13px] text-muted-foreground">
          {HIGHLIGHT_FIELD_LABELS[field]}
        </Label>
        <Select value={values[field]} onValueChange={(v) => set(field, v)} disabled={disabled}>
          <SelectTrigger
            id={`desc-${field}`}
            className="min-h-10 w-full"
            ref={(el) => {
              controls.current[field] = el;
            }}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>Not specified</SelectItem>
            {options.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="rounded-xl border border-border bg-surface-2 p-3"
    >
      <summary className="min-h-8 cursor-pointer text-sm font-medium">
        Current description
        <span className="ml-2 font-normal text-muted-foreground">{plan.caption}</span>
      </summary>
      <div className="mt-3 space-y-2.5">
        <p className="text-[13px]">
          <span className="text-muted-foreground">Action: </span>
          {action.action}
        </p>
        <p className="text-[13px]">
          <span className="text-muted-foreground">Starts: </span>
          {action.startingState}
          <span className="text-muted-foreground"> / Ends: </span>
          {action.endingState}
        </p>
        {select("movement", withCurrent(DIRECTIONS, initial.movement))}
        {select("count", withCurrent(COUNTS, initial.count))}
        <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2">
          <Label htmlFor="desc-timing" className="text-[13px] text-muted-foreground">
            {HIGHLIGHT_FIELD_LABELS.timing}
          </Label>
          <Input
            id="desc-timing"
            className="min-h-10"
            value={values.timing}
            maxLength={80}
            disabled={disabled}
            placeholder="Not specified"
            ref={(el) => {
              controls.current.timing = el;
            }}
            onChange={(e) => set("timing", e.target.value)}
          />
        </div>
        {select("magnitude", withCurrent(MAGNITUDES, initial.magnitude))}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            className="min-h-10"
            disabled={disabled || edits === null}
            onClick={() => edits && onSubmit(edits)}
          >
            Update description
          </Button>
          {edits ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="min-h-10"
              disabled={disabled}
              onClick={() => setValues(initial)}
            >
              Reset
            </Button>
          ) : null}
        </div>
      </div>
    </details>
  );
}
