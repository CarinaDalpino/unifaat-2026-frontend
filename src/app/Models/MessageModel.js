import { DataTypes } from 'sequelize'
import sequelize from '../../database/connections/sequelize.js'

const MessageModel = sequelize.define(
    'MessageModel',
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        ip: {
            type: DataTypes.STRING(45),
            allowNull: false
        },

        name: {
            type: DataTypes.STRING,
            allowNull: false
        },

        message: {
            type: DataTypes.TEXT,
            allowNull: false
        },

        date: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        }
    },
    {
        tableName: 'messages',
        timestamps: false
    }
)

export default MessageModel
