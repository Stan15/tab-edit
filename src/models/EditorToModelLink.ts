import CancelablePromise from "../utils/CancelablePromise";
import EditorUtils from "../utils/EditorUtils";
import Model from "./Model";
import TabTree from "./TabTree";

const secretToken = Symbol('secretToken');
export default class EditorToModelLink {
    static _lastInstance:EditorToModelLink|null = null;
    model:Model;

    static processKillTimeout:number = 2000;
    #currentProcessKillPromise:CancelablePromise<void>|null = null;
    #isDead:boolean;

    #editorRef:HTMLElement = document.getElementById("editor")!;
    get editor() : HTMLElement {
        if (!this.#editorRef) this.#editorRef = document.getElementById("editor")!;
        return this.#editorRef;
    }

    //static factory method
    static create() {
        if (EditorToModelLink._lastInstance && !EditorToModelLink._lastInstance.#isDead) {
            throw new Error("Only one instance of this class can be created");
        }
        let newInstance = new EditorToModelLink(secretToken);
        EditorToModelLink._lastInstance = newInstance;
        return newInstance;
    }
    constructor(token:Symbol) {
        if (token !== secretToken) {
            throw new Error('Constructor is private');
        }
        this.#isDead = false;
        this.model = new Model();
        this.unCache();
    }
    
    kill() {
        this.#isDead = true;
        this.#detachEventListener();
    }

    //set and get if the update happens live (whenever the editor content changes)
    #live:boolean = true;
    get live() { return this.#live }
    set live(bool:boolean) {
        this.#live = bool;
        if (!this.#live) this.#detachEventListener();
        else this.#attachEventListener()
    }

    #attachEventListener = (() => {
        this.editor.oninput = this.updateState;
    }).bind(this);
    #detachEventListener = (() => {
        this.editor.oninput = null;
    }).bind(this);
    
    async updateState() {
        if (this.#isDead) throw new Error("This class instance has been killed and cannot be used any longer");
        let delayEnd = performance.now()+this.model.updateInterval;
        while(performance.now()<delayEnd) {}
        return this.model.update(EditorUtils.getText());
    }

    async killUpdateProcess() {
        this.#currentProcessKillPromise?.cancel();   //stop any .then() that comes from the previous attempt to kill the update process
        this.#currentProcessKillPromise = new CancelablePromise(
            (async function repeatKillAttempt(instance:EditorToModelLink) {
                instance.model.interrupt()
                let killTimeout = performance.now()+EditorToModelLink.processKillTimeout;
                while (instance.model.isActive && performance.now()<killTimeout) {}
                if (instance.model.isActive) throw new Error("Attempt to stop the current running update process timed out");
            })(this)
        );
        return this.#currentProcessKillPromise;
    }

    async unCache() {
        this.#detachEventListener();
        try {
            await this.killUpdateProcess();
            this.model.uncache();
        }catch (e) {
            throw new Error(`Cound not uncache editor object model.\nReason:\n${e.message}`);
        }
    }

}

export type ModelState = {
    oldText:string,
    newText:string,
    textState:string,
    tree:TabTree,
    update():void
}

type UpdateProcess = {
    delay:number,
    isActive:boolean,
    runTimeoutID:number|null,
    killPromise:CancelablePromise<void>|null,
    killAttemptDelay:number,
    killSignal:boolean,
    killTimeoutDuration:number
}