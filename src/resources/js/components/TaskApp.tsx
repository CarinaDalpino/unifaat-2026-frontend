import { useState } from "react"
import type { Task } from "../types/api"
import { taskCreateApi } from "../api/taskCreateApi"
import { taskUpdateApi } from "../api/taskUpdateApi"
import { taskDeleteApi } from "../api/taskDeleteApi"
import { TaskItem } from "./TaskItem"

type TaskAppProps = {
    idUser: number
    initialTasks: Task[]
}

export function TaskApp({ idUser, initialTasks }: TaskAppProps) {
    const [tasks, setTasks] = useState<Task[]>(initialTasks)
    const [name, setName] = useState("")

    const pending = tasks.filter(task => !task.is_done).length

    // C: create
    async function create() {
        if (name.trim() === "") return

        const created = await taskCreateApi(idUser, { name })
        setTasks(current => [...current, created])
        setName("")
    }

    // U: update (marcar/desmarcar como feita)
    async function toggle(task: Task) {
        const updated = await taskUpdateApi(idUser, task.id, { is_done: !task.is_done })
        setTasks(current => current.map(item => {
            if (item.id !== updated.id) return item
            return updated
        }))
    }

    // D: delete
    async function remove(id: number) {
        await taskDeleteApi(idUser, id)
        setTasks(current => current.filter(task => task.id !== id))
    }

    return (
        <section>
            <div className="input-group mb-3">
                <input
                    className="form-control"
                    value={name}
                    onChange={event => setName(event.target.value)}
                />
                <button className="btn btn-primary" onClick={create}>Adicionar</button>
            </div>

            <p>{pending} pendente(s)</p>

            <ul className="list-group">
                {tasks.map(task => (
                    <TaskItem key={task.id} task={task} onToggle={toggle} onDelete={remove} />
                ))}
            </ul>
        </section>
    )
}
