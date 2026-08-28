import type { Contract, Doubled, Seat, Strain } from "@/lib/types";

const SEATS = new Set(["N", "E", "S", "W"]);
const STRAIN_LABEL: Record<Strain, string> = {
  C: "♣", D: "♦", H: "♥", S: "♠", N: "NT",
};

export class ContractParseError extends Error {}

/**
 * Parse a shorthand contract such as "4HxN+1" into its parts.
 *
 * Accepts any spacing and casing, "NT" or "N" for notrump, "x"/"xx" on
 * either side of the declarer, and an omitted result meaning "=".
 * A passed-out board is "pass", "p" or "-".
 *
 * Note that strain and declarer letters overlap (N, S), so the strain is
 * always taken first and greedily: "4NS" is 4NT by South, "4SN" is 4S by
 * North, and "4NN" is 4NT by North.
 */
export function parseContract(input: string): Contract {
  const text = input.replace(/\s+/g, "").toUpperCase();
  if (text === "") throw new ContractParseError("Enter a contract");
  if (text === "PASS" || text === "P" || text === "-") return { passedOut: true };

  let i = 0;

  const level = Number(text[i]);
  if (!Number.isInteger(level) || level < 1 || level > 7) {
    throw new ContractParseError(`Level must be 1-7, got "${text[0]}"`);
  }
  i += 1;

  let strain: Strain;
  if (text.startsWith("NT", i)) { strain = "N"; i += 2; }
  else if ("CDHSN".includes(text[i] ?? "")) { strain = text[i] as Strain; i += 1; }
  else throw new ContractParseError(`Expected a suit or NT after "${level}"`);

  // Doubles may appear before or after the declarer: "4HxN+1" or "4HNx+1".
  let doubled: Doubled = 0;
  const readDoubles = () => {
    if (text.startsWith("XX", i)) { doubled = 2; i += 2; }
    else if (text[i] === "X") { doubled = 1; i += 1; }
  };
  readDoubles();

  const seat = text[i];
  if (!seat || !SEATS.has(seat)) {
    throw new ContractParseError("Missing declarer (N, E, S or W)");
  }
  const declarer = seat as Seat;
  i += 1;

  if (doubled === 0) readDoubles();

  const rest = text.slice(i);
  let result: number;
  if (rest === "" || rest === "=") result = 0;
  else if (/^[+-]\d+$/.test(rest)) result = Number(rest);
  else throw new ContractParseError(`Expected "=", "+n" or "-n", got "${rest}"`);

  const maxOvertricks = 7 - level;
  if (result > maxOvertricks) {
    throw new ContractParseError(`${level}${strain} can only make +${maxOvertricks}`);
  }
  if (result < -(level + 6)) {
    throw new ContractParseError(`${level}${strain} can only go down ${level + 6}`);
  }

  return { passedOut: false, level: level as 1, strain, doubled, declarer, result };
}

/** Render a contract for display, e.g. "4♥x by N, +1". */
export function formatContract(contract: Contract): string {
  if (contract.passedOut) return "Passed out";
  const { level, strain, doubled, declarer, result } = contract;
  const marks = doubled === 2 ? "xx" : doubled === 1 ? "x" : "";
  const made = result === 0 ? "=" : result > 0 ? `+${result}` : `${result}`;
  return `${level}${STRAIN_LABEL[strain]}${marks} by ${declarer}, ${made}`;
}

/** Total tricks taken, as shown in the "Result" column of a scoresheet. */
export function tricksTaken(contract: Contract): number | null {
  return contract.passedOut ? null : contract.level + 6 + contract.result;
}
