import { BrandLogoFrame } from "@/components/brand/brand-logo";
import { cn } from "@/lib/utils";

type ProjectLibraryCoverProps = {
    status: string;
    tone: string;
    statusDetail?: string;
};

/** Placeholder cover for projects that do not have generated artwork yet. */
export function ProjectLibraryCover({ status, tone, statusDetail }: ProjectLibraryCoverProps) {
    return (
        <div className="project-collection-generated-cover">
            <span
                className={cn("project-summary-status", `is-${tone}`)}
                title={statusDetail}
            >
                {status}
            </span>
            <div className="project-collection-generated-mark" aria-hidden="true">
                <BrandLogoFrame
                    className="project-collection-generated-logo-frame"
                    logoClassName="project-collection-generated-logo"
                    alt=""
                    theme="auto"
                    fallback={<span className="project-collection-generated-logo-fallback">灵</span>}
                />
            </div>
        </div>
    );
}
