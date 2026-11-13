import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { ExpandableSearch } from "./expandable-search";
import { PageHeader } from "./workspace-page";
import "@/styles/collection-header.css";

export type CollectionHeaderTab<Value extends string> = {
    value: Value;
    label: string;
    count?: number;
    icon?: LucideIcon;
};

export function CollectionHeader<Value extends string>({
    title,
    description,
    className,
    search,
    actions,
    primaryAction,
    tabs,
    value,
    onChange,
    navigationLabel,
    trailing,
}: {
    title: string;
    description?: string;
    className?: string;
    search?: { value: string; onChange: (value: string) => void; placeholder: string };
    actions?: ReactNode;
    primaryAction?: ReactNode;
    tabs: CollectionHeaderTab<Value>[];
    value: Value;
    onChange: (value: Value) => void;
    navigationLabel: string;
    trailing?: ReactNode;
}) {
    return (
        <section className={cn("collection-header studio-band", className)}>
            <PageHeader
                title={title}
                description={description}
                actions={(
                    <div className="collection-header-tools">
                        {search ? <ExpandableSearch {...search} /> : null}
                        {actions}
                        {primaryAction}
                    </div>
                )}
            />
            <div className="collection-header-navigation">
                <nav className="collection-header-tabs" aria-label={navigationLabel}>
                    {tabs.map((tab) => {
                        const Icon = tab.icon;
                        const active = value === tab.value;
                        return (
                            <button
                                key={tab.value}
                                type="button"
                                aria-pressed={active}
                                className={cn("collection-header-tab", active && "is-active")}
                                onClick={() => onChange(tab.value)}
                            >
                                {Icon ? <Icon aria-hidden="true" /> : null}
                                <span>{tab.label}</span>
                                {tab.count !== undefined ? <em>{tab.count}</em> : null}
                            </button>
                        );
                    })}
                </nav>
                {trailing ? <div className="collection-header-trailing">{trailing}</div> : null}
            </div>
        </section>
    );
}
