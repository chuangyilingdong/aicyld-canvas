import type { DragEvent, KeyboardEvent, ReactNode } from "react";

import { cn } from "@/lib/utils";

type LibraryCardShellProps = {
    ariaLabel: string;
    className?: string;
    cover: ReactNode;
    title: ReactNode;
    updatedAt: string;
    actions?: ReactNode;
    onOpen: () => void;
    onPointerEnter?: () => void;
    onPointerDown?: () => void;
    onFocusCapture?: () => void;
    openDisabled?: boolean;
    onboardingProjectId?: string;
    /** 画布卡片作为拖拽源、文件夹卡片作为落点时使用。 */
    draggable?: boolean;
    onDragStart?: (event: DragEvent<HTMLElement>) => void;
    onDragEnd?: () => void;
    onDragOver?: (event: DragEvent<HTMLElement>) => void;
    onDragLeave?: () => void;
    onDrop?: (event: DragEvent<HTMLElement>) => void;
};

/** Shared visual shell for folder and project cards. Only cover and actions vary. */
export function LibraryCardShell({ ariaLabel, className, cover, title, updatedAt, actions, onOpen, onPointerEnter, onPointerDown, onFocusCapture, openDisabled = false, onboardingProjectId, draggable, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop }: LibraryCardShellProps) {
    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.target !== event.currentTarget || openDisabled) return;
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
        }
    };

    return (
        <article
            className={cn("libtv-library-card", className)}
            onPointerEnter={onPointerEnter}
            onPointerDown={onPointerDown}
            onFocusCapture={onFocusCapture}
            draggable={draggable}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            <div className="libtv-library-card-open" data-onboarding-project={onboardingProjectId} role="button" tabIndex={0} aria-label={ariaLabel} aria-disabled={openDisabled || undefined} onClick={() => !openDisabled && onOpen()} onKeyDown={handleKeyDown}>
                <div className="libtv-library-card-cover" aria-hidden="true">{cover}</div>
                <div className="libtv-library-card-body">
                    <div className="libtv-library-card-title">{title}</div>
                    <time className="libtv-library-card-date" dateTime={updatedAt}>{formatLibraryDate(updatedAt)}</time>
                </div>
            </div>
            {actions}
        </article>
    );
}

export function formatLibraryDate(value: string) {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return "时间不可用";
    const date = new Date(timestamp);
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
