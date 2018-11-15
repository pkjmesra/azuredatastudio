/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

 import * as sqlops from 'sqlops';

import { Action } from 'vs/base/common/actions';
import { TPromise } from 'vs/base/common/winjs.base';
import { localize } from 'vs/nls';
import { IContextViewProvider } from 'vs/base/browser/ui/contextview/contextview';

import { SelectBox } from 'sql/base/browser/ui/selectBox/selectBox';
import { INotebookModel, notebookConstants } from 'sql/parts/notebook/models/modelInterfaces';
import { CellType } from 'sql/parts/notebook/models/contracts';
import { NotebookComponent } from 'sql/parts/notebook/notebook.component';
import { NotebookConnection } from 'sql/parts/notebook/models/notebookConnection';
import { IConnectionProfile } from 'sql/parts/connection/common/interfaces';

const msgLoading = localize('loading', 'Loading kernels...');
const msgLoadingContexts = localize('loadingContexts', 'Loading contexts...');
const msgAddNewConnection = localize('addNewConnection', 'Add new connection');
const msgSelectConnection = localize('selectConnection', 'Select connection');
const msgConnectionNotApplicable = localize('connectionNotSupported', 'n/a');

//Action to add a cell to notebook based on cell type(code/markdown).
export class AddCellAction extends Action {
	public cellType: CellType;

	constructor(
		id: string, label: string, cssClass: string
	) {
		super(id, label, cssClass);
	}
	public run(context: NotebookComponent): TPromise<boolean> {
		return new TPromise<boolean>((resolve, reject) => {
			try {
				context.addCell(this.cellType);
				resolve(true);
			} catch (e) {
				reject(e);
			}
		});
	}
}

export class KernelsDropdown extends SelectBox {
	private model: INotebookModel;
	constructor(contextViewProvider: IContextViewProvider, modelRegistered: Promise<INotebookModel>
	) {
		super( [msgLoading], msgLoading, contextViewProvider);
		if (modelRegistered) {
			modelRegistered
			.then((model) => this.updateModel(model))
			.catch((err) => {
				// No-op for now
			});
		}

		this.onDidSelect(e => this.doChangeKernel(e.selected));
	}

	updateModel(model: INotebookModel): void {
		this.model = model;
		model.kernelsChanged((defaultKernel) => {
			this.updateKernel(defaultKernel);
		});
		if (model.clientSession) {
			model.clientSession.kernelChanged((changedArgs: sqlops.nb.IKernelChangedArgs) => {
				if (changedArgs.newValue) {
					this.updateKernel(changedArgs.newValue);
				}
			});
		}
	}

	// Update SelectBox values
	private updateKernel(defaultKernel: sqlops.nb.IKernelSpec) {
		let specs = this.model.specs;
		if (specs && specs.kernels) {
			let index = specs.kernels.findIndex((kernel => kernel.name === defaultKernel.name));
			this.setOptions(specs.kernels.map(kernel => kernel.display_name), index);
		}
	}

	public doChangeKernel(displayName: string): void {
		this.model.changeKernel(displayName);
	}
}

export class AttachToDropdown extends SelectBox {
	private model: INotebookModel;

	constructor(contextViewProvider: IContextViewProvider, modelRegistered: Promise<INotebookModel>) {
		super([msgLoadingContexts], msgLoadingContexts, contextViewProvider);
		if (modelRegistered) {
			modelRegistered
			.then((model) => this.updateModel(model))
			.catch((err) => {
				// No-op for now
			});
		}
		this.onDidSelect(e => {
			let connectionProfile = this.model.contexts.otherConnections.find((c) => c.options.host === e.selected);
			let connection: sqlops.connection.Connection = {
				providerName: connectionProfile.providerName,
				connectionId: connectionProfile.id,
				options: connectionProfile.options
			};
			this.doChangeContext(connection);
		});
	}

	public updateModel(model: INotebookModel): void {
		this.model = model;
		model.contextsChanged(() => {
			let contexts = this.model.contexts;
			let defaultConnectionName = [contexts.defaultConnection.options.host];
			this.setOptions(defaultConnectionName.concat(contexts.otherConnections.map((context) => context.options.host)));
		});
	}

	// Load "Attach To" dropdown with the values corresponding to Kernel dropdown
	public async loadAttachToDropdown(model: INotebookModel, currentKernel: string): Promise<void> {
		if (currentKernel === notebookConstants.python3) {
			this.setOptions([msgConnectionNotApplicable]);
			this.disable();
		}
		else {
			let hadoopConnections = this.getHadoopConnections(model);
			this.enable();
			if (hadoopConnections.length === 1 && hadoopConnections[0] === msgAddNewConnection) {
				hadoopConnections.unshift(msgSelectConnection);
				this.selectWithOptionName(msgSelectConnection);
			}
			else {
				hadoopConnections.push(msgAddNewConnection);
			}
			this.setOptions(hadoopConnections);
		}

	}

	    //Get hadoop connections from context
		public getHadoopConnections(model: INotebookModel): string[] {
			let otherHadoopConnections: sqlops.IConnectionProfile[] = [];
			model.contexts.otherConnections.forEach((conn) => { otherHadoopConnections.push(conn); });
			this.selectWithOptionName(model.contexts.defaultConnection.options.host);
			otherHadoopConnections = this.setHadoopConnectionsList(model.contexts.defaultConnection, model.contexts.otherConnections);
			let hadoopConnections = otherHadoopConnections.map((context) => context.options.host);
			return hadoopConnections;
		}

		private setHadoopConnectionsList(defaultHadoopConnection: IConnectionProfile, otherHadoopConnections: IConnectionProfile[]) {
			if (defaultHadoopConnection.options.host !== msgSelectConnection) {
				otherHadoopConnections = otherHadoopConnections.filter(conn => conn.options.host !== defaultHadoopConnection.options.host);
				otherHadoopConnections.unshift(defaultHadoopConnection);
				if (otherHadoopConnections.length > 1) {
					otherHadoopConnections = otherHadoopConnections.filter(val => val.options.host !== msgSelectConnection);
				}
			}
			return otherHadoopConnections;
		}

	public doChangeContext(connection?: sqlops.connection.Connection): void {
		if (this.value === msgAddNewConnection) {
            this.openConnectionDialog();
        } else {
            this.model.changeContext(this.value, connection);
        }
	}

	/**
     * Open connection dialog
     * Enter server details and connect to a server from the dialog
     * Bind the server value to 'Attach To' drop down
     * Connected server is displayed at the top of drop down
     **/
    public async openConnectionDialog(): Promise<void> {
        try {
            await sqlops.connection.openConnectionDialog([notebookConstants.hadoopKnoxProviderName]).then(connection => {
                let attachToConnections = this.values;
                if (!connection) {
                    this.loadAttachToDropdown(this.model, this.model.clientSession.kernel.name);
                    return;
                }
                let connectedServer = connection.options[notebookConstants.hostPropName];
                //Check to see if the same host is already there in dropdown. We only have host names in dropdown
                if (attachToConnections.some(val => val === connectedServer)) {
                    this.loadAttachToDropdown(this.model, this.model.clientSession.kernel.name);
                    this.doChangeContext();
                    return;
                }
                else {
                    attachToConnections.unshift(connectedServer);
                }
                //To ignore n/a after we have at least one valid connection
				attachToConnections = attachToConnections.filter(val => val !== msgSelectConnection);

				let index = attachToConnections.findIndex((connection => connection === connectedServer));
				this.setOptions(attachToConnections, index);

                // Call doChangeContext to set the newly chosen connection in the model
                this.doChangeContext(connection);
            });
        }
        catch (error) {
            // vscode.window.showErrorMessage("openConnectionDialog: {0}", utils.getErrorMessage(error));
        }
    }
}