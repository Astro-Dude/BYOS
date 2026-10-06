"use client";

import { useState } from "react";

import { Dropdown } from "@/components/byok/dropdown";
import { COUNTRY_CODES } from "@/lib/country-codes";

const OPTIONS = COUNTRY_CODES.map((c) => ({
  value: c.iso,
  label: `${c.iso} ${c.dial}`,
  keywords: `${c.name} ${c.dial}`,
}));

/** Dial-code picker for phone fields. Selects by country rather than by code,
 *  because several countries share one (+1 is both the US and Canada). */
export function CountryCodePicker({
  dial,
  onChange,
}: {
  dial: string;
  onChange: (dial: string) => void;
}) {
  const [iso, setIso] = useState(
    () => COUNTRY_CODES.find((c) => c.dial === dial)?.iso ?? "IN",
  );
  return (
    <Dropdown
      searchable
      ariaLabel="Country code"
      value={iso}
      onChange={(next) => {
        setIso(next);
        const country = COUNTRY_CODES.find((c) => c.iso === next);
        if (country) onChange(country.dial);
      }}
      options={OPTIONS}
      className="h-full whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-3 py-3 text-[0.9375rem] text-zinc-900 outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900"
    />
  );
}
