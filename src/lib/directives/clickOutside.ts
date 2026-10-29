import type { Action } from 'svelte/action';

const clickOutside: Action<HTMLElement, () => void> = (
    element,
    callbackFunction
) => {
    let callback = callbackFunction;

    function onClick(event: MouseEvent) {
        if (!element.contains(event.target as Node)) {
            callback();
        }
    }

    document.body.addEventListener('click', onClick);

    return {
        update(newCallbackFunction) {
            callback = newCallbackFunction;
        },
        destroy() {
            document.body.removeEventListener('click', onClick);
        }
    };
};

export { clickOutside };