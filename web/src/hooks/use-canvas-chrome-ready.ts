import { useEffect, useState } from "react";

/** Delay non-critical canvas chrome until after the first rendered frames. */
export function useCanvasChromeReady() {
    const [ready, setReady] = useState(false);
    useEffect(() => {
        const finish = () => setReady(true);
        const fallback = setTimeout(finish, 300);
        let frame = requestAnimationFrame(() => {
            frame = requestAnimationFrame(finish);
        });
        return () => {
            clearTimeout(fallback);
            cancelAnimationFrame(frame);
        };
    }, []);
    return ready;
}
