'use client';

import { useEffect, useState } from 'react';

export type Density = 'compact' | 'ultra';

const STORAGE_KEY = 'engine-dj-manager:density';
const DEFAULT_DENSITY: Density = 'compact';

export interface DensityTokens {
    pad: string;
    gap: number;
    fontMain: string;
    fontMeta: string;
    headerFont: string;
    headerMargin: string;
    tablePad: string;
    tableHeaderPad: string;
    hoverX: number;
    buttonPad: string;
}

export function densityTokens(d: Density): DensityTokens {
    if (d === 'ultra') {
        return {
            pad: '3px 6px',
            gap: 1,
            fontMain: '0.75rem',
            fontMeta: '0.65rem',
            headerFont: '0.9rem',
            headerMargin: '6px',
            tablePad: '4px 6px',
            tableHeaderPad: '6px 6px',
            hoverX: 1,
            buttonPad: '6px 10px',
        };
    }
    return {
        pad: '5px 8px',
        gap: 2,
        fontMain: '0.8rem',
        fontMeta: '0.7rem',
        headerFont: '1rem',
        headerMargin: '10px',
        tablePad: '6px 8px',
        tableHeaderPad: '8px 8px',
        hoverX: 2,
        buttonPad: '7px 12px',
    };
}

function readStored(): Density {
    if (typeof window === 'undefined') return DEFAULT_DENSITY;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw === 'compact' || raw === 'ultra') return raw;
    } catch {}
    return DEFAULT_DENSITY;
}

export function useDensity(): [Density, (d: Density) => void] {
    const [density, setDensityState] = useState<Density>(DEFAULT_DENSITY);

    useEffect(() => {
        setDensityState(readStored());
    }, []);

    const setDensity = (d: Density) => {
        setDensityState(d);
        try {
            window.localStorage.setItem(STORAGE_KEY, d);
        } catch {}
    };

    return [density, setDensity];
}
