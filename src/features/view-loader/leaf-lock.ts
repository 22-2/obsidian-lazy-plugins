import { WorkspaceLeaf } from "obsidian";
import { Mutex } from "async-mutex";

/**
 * Generic lock strategy interface for async mutual exclusion
 */
export interface LockStrategy<T> {
    lock(target: T): Promise<LockRelease>;
}

export interface LockRelease {
    unlock(): void;
}

/**
 * Centralized lock manager that uses WeakMap to associate Mutexes with WorkspaceLeafs.
 * This ensures that when a leaf is destroyed/GC'd, its associated Mutexes are also collected.
 */
export class LeafLockManager {
    private leafMutexes = new WeakMap<WorkspaceLeaf, Map<string, Mutex>>();

    /**
     * Acquires a lock for a specific leaf, optionally specialized by a sub-key (like viewType).
     */
    async lock(leaf: WorkspaceLeaf, subKey: string = "default"): Promise<LockRelease> {
        let subMap = this.leafMutexes.get(leaf);
        if (!subMap) {
            subMap = new Map<string, Mutex>();
            this.leafMutexes.set(leaf, subMap);
        }

        let mutex = subMap.get(subKey);
        if (!mutex) {
            mutex = new Mutex();
            subMap.set(subKey, mutex);
        }

        const release = await mutex.acquire();
        return {
            unlock: () => {
                release();
            },
        };
    }
}

/**
 * Specialized strategy for locking a leaf based on its viewType.
 * (Used by ViewLazyLoader)
 */
export class LeafViewLockStrategy implements LockStrategy<{ leaf: WorkspaceLeaf; viewType: string }> {
    constructor(private manager: LeafLockManager) {}

    async lock(target: { leaf: WorkspaceLeaf; viewType: string }): Promise<LockRelease> {
        return this.manager.lock(target.leaf, `view:${target.viewType}`);
    }
}

/**
 * Specialized strategy for locking a leaf regardless of its viewType.
 * (Used by FileLazyLoader)
 */
export class LeafLockStrategy implements LockStrategy<WorkspaceLeaf> {
    constructor(private manager: LeafLockManager) {}

    async lock(leaf: WorkspaceLeaf): Promise<LockRelease> {
        return this.manager.lock(leaf, "leaf-generic");
    }
}

/**
 * No-op lock strategy for testing
 */
export class NoOpLockStrategy<T> implements LockStrategy<T> {
    async lock(_target: T): Promise<LockRelease> {
        return { unlock: () => {} };
    }
}
