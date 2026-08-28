import type { ProviderUserInputAnswers } from "@t3tools/contracts";
import { CheckIcon } from "lucide-react";
import { useState } from "react";

import type { PendingUserInput } from "../../session-logic";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";

export function BotChoicePrompt({
  prompt,
  responding,
  error,
  onAnswer,
}: {
  readonly prompt: PendingUserInput;
  readonly responding: boolean;
  readonly error: string | null;
  readonly onAnswer: (answers: ProviderUserInputAnswers) => Promise<boolean>;
}) {
  const question = prompt.questions[0];
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [customAnswer, setCustomAnswer] = useState("");
  if (!question) return null;

  const submit = (answer: string | readonly string[]) => {
    if ((typeof answer === "string" && answer.trim().length === 0) || answer.length === 0) return;
    void onAnswer({ [question.id]: answer });
  };

  return (
    <section
      aria-label={question.header}
      className="w-full max-w-2xl rounded-2xl border border-border bg-foreground/5 p-3"
      data-testid="bot-choice-prompt"
    >
      <p className="text-sm font-medium">{question.question}</p>
      {question.options.length > 0 ? (
        <div className="mt-3 overflow-hidden rounded-xl border border-border">
          {question.options.map((option, index) => {
            const isSelected = selected.includes(option.label);
            return (
              <button
                key={option.label}
                type="button"
                disabled={responding}
                className={cn(
                  "flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-foreground/5 disabled:opacity-50",
                  isSelected && "bg-foreground/8",
                )}
                onClick={() => {
                  if (!question.multiSelect) {
                    setSelected([option.label]);
                    submit(option.label);
                    return;
                  }
                  setSelected((current) =>
                    current.includes(option.label)
                      ? current.filter((label) => label !== option.label)
                      : [...current, option.label],
                  );
                }}
              >
                <span className="flex size-5 shrink-0 items-center justify-center rounded bg-foreground/8 text-xs text-muted-foreground">
                  {isSelected ? <CheckIcon className="size-3" /> : String.fromCharCode(65 + index)}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium">{option.label}</span>
                  {option.description !== option.label ? (
                    <span className="block text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit(customAnswer.trim());
          }}
        >
          <Input
            aria-label="Answer"
            value={customAnswer}
            disabled={responding}
            onChange={(event) => setCustomAnswer(event.currentTarget.value)}
          />
          <Button type="submit" disabled={responding || customAnswer.trim().length === 0}>
            Send
          </Button>
        </form>
      )}
      {question.multiSelect ? (
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            disabled={responding || selected.length === 0}
            onClick={() => submit(selected)}
          >
            Continue
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
