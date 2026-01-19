'use client'

import { useCallback, useMemo } from 'react'
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  Node,
  Edge,
  MarkerType,
  NodeTypes,
  Handle,
  Position,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import Link from 'next/link'

interface TopicMindmapProps {
  topic: string
  speakers: Array<{ name: string; displayName: string }>
  transcripts: Array<{
    meetingId: string
    title: string
    date: string
    speakers: string[]
  }>
  relatedTopics: Array<{ topic: string; coOccurrenceCount: number }>
}

// Custom node components
function CenterTopicNode({ data }: { data: { label: string } }) {
  return (
    <div className="px-6 py-4 bg-gradient-to-br from-purple-600 to-purple-800 rounded-xl shadow-lg border-2 border-purple-400 min-w-[120px] text-center">
      <Handle type="source" position={Position.Top} className="!bg-purple-400" />
      <Handle type="source" position={Position.Right} className="!bg-purple-400" />
      <Handle type="source" position={Position.Bottom} className="!bg-purple-400" />
      <Handle type="source" position={Position.Left} className="!bg-purple-400" />
      <span className="text-white font-bold text-lg">{data.label}</span>
    </div>
  )
}

function SpeakerNode({ data }: { data: { label: string; name: string } }) {
  return (
    <Link
      href={`/speakers/${encodeURIComponent(data.name)}`}
      className="block px-4 py-2 bg-blue-900/80 hover:bg-blue-800 rounded-lg shadow border border-blue-600 transition-colors min-w-[100px] text-center"
    >
      <Handle type="target" position={Position.Left} className="!bg-blue-400" />
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 bg-blue-700 rounded-full flex items-center justify-center text-xs text-white">
          {data.label.charAt(0).toUpperCase()}
        </div>
        <span className="text-blue-100 text-sm font-medium">{data.label}</span>
      </div>
    </Link>
  )
}

function TranscriptNode({ data }: { data: { label: string; meetingId: string; date: string } }) {
  return (
    <Link
      href={`/transcripts/${encodeURIComponent(data.meetingId)}`}
      className="block px-4 py-2 bg-green-900/80 hover:bg-green-800 rounded-lg shadow border border-green-600 transition-colors max-w-[200px] text-center"
    >
      <Handle type="target" position={Position.Top} className="!bg-green-400" />
      <div className="flex flex-col">
        <span className="text-green-100 text-sm font-medium truncate">{data.label}</span>
        <span className="text-green-300 text-xs">{data.date}</span>
      </div>
    </Link>
  )
}

function RelatedTopicNode({ data }: { data: { label: string; count: number } }) {
  return (
    <Link
      href={`/topics/${encodeURIComponent(data.label)}`}
      className="block px-4 py-2 bg-orange-900/80 hover:bg-orange-800 rounded-lg shadow border border-orange-600 transition-colors min-w-[80px] text-center"
    >
      <Handle type="target" position={Position.Right} className="!bg-orange-400" />
      <div className="flex flex-col">
        <span className="text-orange-100 text-sm font-medium">{data.label}</span>
        <span className="text-orange-300 text-xs">{data.count}x</span>
      </div>
    </Link>
  )
}

const nodeTypes: NodeTypes = {
  centerTopic: CenterTopicNode,
  speaker: SpeakerNode,
  transcript: TranscriptNode,
  relatedTopic: RelatedTopicNode,
}

export default function TopicMindmap({
  topic,
  speakers,
  transcripts,
  relatedTopics,
}: TopicMindmapProps) {
  // Calculate node positions in a radial layout
  const { initialNodes, initialEdges } = useMemo(() => {
    const nodes: Node[] = []
    const edges: Edge[] = []

    // Center node
    nodes.push({
      id: 'center',
      type: 'centerTopic',
      position: { x: 400, y: 300 },
      data: { label: topic },
    })

    // Speakers on the right
    const maxSpeakers = Math.min(speakers.length, 8)
    const speakerSpacing = 70
    const speakerStartY = 300 - ((maxSpeakers - 1) * speakerSpacing) / 2

    speakers.slice(0, maxSpeakers).forEach((speaker, index) => {
      const nodeId = `speaker-${index}`
      nodes.push({
        id: nodeId,
        type: 'speaker',
        position: { x: 650, y: speakerStartY + index * speakerSpacing },
        data: { label: speaker.displayName, name: speaker.name },
      })
      edges.push({
        id: `e-center-${nodeId}`,
        source: 'center',
        target: nodeId,
        sourceHandle: Position.Right,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: '#60a5fa' },
      })
    })

    // Transcripts at the bottom
    const maxTranscripts = Math.min(transcripts.length, 6)
    const transcriptSpacing = 180
    const transcriptStartX = 400 - ((maxTranscripts - 1) * transcriptSpacing) / 2

    transcripts.slice(0, maxTranscripts).forEach((transcript, index) => {
      const nodeId = `transcript-${index}`
      nodes.push({
        id: nodeId,
        type: 'transcript',
        position: { x: transcriptStartX + index * transcriptSpacing, y: 500 },
        data: {
          label: transcript.title,
          meetingId: transcript.meetingId,
          date: transcript.date,
        },
      })
      edges.push({
        id: `e-center-${nodeId}`,
        source: 'center',
        target: nodeId,
        sourceHandle: Position.Bottom,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: '#4ade80' },
      })
    })

    // Related topics on the left
    const maxRelated = Math.min(relatedTopics.length, 8)
    const relatedSpacing = 60
    const relatedStartY = 300 - ((maxRelated - 1) * relatedSpacing) / 2

    relatedTopics.slice(0, maxRelated).forEach((related, index) => {
      const nodeId = `related-${index}`
      nodes.push({
        id: nodeId,
        type: 'relatedTopic',
        position: { x: 100, y: relatedStartY + index * relatedSpacing },
        data: { label: related.topic, count: related.coOccurrenceCount },
      })
      edges.push({
        id: `e-center-${nodeId}`,
        source: 'center',
        target: nodeId,
        sourceHandle: Position.Left,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: '#fb923c' },
      })
    })

    return { initialNodes: nodes, initialEdges: edges }
  }, [topic, speakers, transcripts, relatedTopics])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  return (
    <div className="w-full h-[500px] bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#3f3f46" />
        <Controls className="!bg-zinc-800 !border-zinc-700 [&>button]:!bg-zinc-800 [&>button]:!border-zinc-700 [&>button]:!text-zinc-400 [&>button:hover]:!bg-zinc-700" />
        <MiniMap
          className="!bg-zinc-800 !border-zinc-700"
          nodeColor={(node) => {
            switch (node.type) {
              case 'centerTopic':
                return '#a855f7'
              case 'speaker':
                return '#3b82f6'
              case 'transcript':
                return '#22c55e'
              case 'relatedTopic':
                return '#f97316'
              default:
                return '#71717a'
            }
          }}
        />
      </ReactFlow>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 flex gap-4 text-xs bg-zinc-900/90 px-3 py-2 rounded-lg border border-zinc-800">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-purple-500"></div>
          <span className="text-zinc-400">Topic</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-blue-500"></div>
          <span className="text-zinc-400">Speakers ({speakers.length})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-green-500"></div>
          <span className="text-zinc-400">Meetings ({transcripts.length})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-orange-500"></div>
          <span className="text-zinc-400">Related ({relatedTopics.length})</span>
        </div>
      </div>
    </div>
  )
}
